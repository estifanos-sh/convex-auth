/**
 * Decoding what WorkOS's API sends: events, list pages and the objects in
 * them. Everything WorkOS sends is untrusted JSON, so each object is checked
 * against the fields the sync reads before it is used, and anything else
 * fails as a {@link DecodeError}.
 *
 * @module
 */
import { GenericValidator, Infer, v } from "convex/values";
import type { Domain, Event, Update } from "./changes.ts";
import { vMembershipStatus } from "./schema.ts";

export const EVENTS = [
  "dsync.activated",
  "dsync.deleted",
  "dsync.user.created",
  "dsync.user.updated",
  "dsync.user.deleted",
  "dsync.group.created",
  "dsync.group.updated",
  "dsync.group.deleted",
  "dsync.group.user_added",
  "dsync.group.user_removed",
  "organization.created",
  "organization.updated",
  "organization.deleted",
  "organization_membership.created",
  "organization_membership.updated",
  "organization_membership.deleted",
  "organization_domain.created",
  "organization_domain.updated",
  "organization_domain.deleted",
  "organization_domain.verified",
  "organization_domain.verification_failed",
  "connection.activated",
  "connection.deactivated",
  "connection.deleted",
  "user.created",
  "user.updated",
  "user.deleted",
] as const;

export const vEndpoint = v.union(
  v.literal("organizations"),
  v.literal("users"),
  v.literal("memberships"),
  v.literal("connections"),
  v.literal("directories"),
  v.literal("directoryUsers"),
  v.literal("directoryGroups"),
  v.literal("groupMembers"),
);
export type Endpoint = Infer<typeof vEndpoint>;

const text = v.optional(v.union(v.string(), v.null()));

const WireDomain = v.object({
  id: v.string(),
  domain: v.string(),
  organization_id: text,
  state: text,
  updated_at: text,
});
const WireOrganization = v.object({
  id: v.string(),
  name: v.string(),
  external_id: text,
  domains: v.optional(v.array(WireDomain)),
  updated_at: v.string(),
});
const WireUser = v.object({
  id: v.string(),
  email: v.string(),
  email_verified: v.boolean(),
  first_name: text,
  last_name: text,
  profile_picture_url: text,
  external_id: text,
  updated_at: v.string(),
});
const WireMembership = v.object({
  id: v.string(),
  user_id: v.string(),
  organization_id: v.string(),
  role: v.object({ slug: v.string() }),
  status: vMembershipStatus,
  updated_at: v.string(),
});
const WireConnection = v.object({
  id: v.string(),
  organization_id: text,
  connection_type: v.string(),
  state: v.string(),
  updated_at: v.string(),
});
const WireDirectory = v.object({
  id: v.string(),
  organization_id: text,
  name: v.string(),
  type: v.string(),
  state: v.string(),
  updated_at: v.string(),
});
const WireDirectoryUser = v.object({
  id: v.string(),
  directory_id: v.string(),
  organization_id: text,
  idp_id: v.string(),
  email: text,
  first_name: text,
  last_name: text,
  state: v.string(),
  updated_at: v.string(),
});
const WireGroup = v.object({
  id: v.string(),
  directory_id: v.string(),
  organization_id: text,
  name: v.string(),
  updated_at: v.string(),
});
const WireEdge = v.object({
  directory_id: v.string(),
  user: v.object({ id: v.string() }),
  group: v.object({ id: v.string(), organization_id: text }),
});
const WireEvent = v.object({
  id: v.string(),
  event: v.string(),
  data: v.any(),
  created_at: v.string(),
});
const WireList = v.object({
  data: v.array(v.any()),
  list_metadata: v.object({ after: text }),
});

export class DecodeError extends Error {
  override readonly name = "DecodeError";
}

/**
 * Whether `value` has every field `validator` describes. Fields WorkOS adds
 * that the validator doesn't name are allowed, since WorkOS grows its objects
 * over time.
 */
export function matches(validator: GenericValidator, value: unknown): boolean {
  switch (validator.kind) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "float64":
      return typeof value === "number";
    case "null":
      return value === null;
    case "any":
      return true;
    case "literal":
      return value === validator.value;
    case "array":
      return (
        Array.isArray(value) &&
        value.every((item) => matches(validator.element, item))
      );
    case "union":
      return validator.members.some((member) => matches(member, value));
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
      }
      const fields = value as Record<string, unknown>;
      return Object.entries(validator.fields).every(([name, field]) =>
        fields[name] === undefined
          ? field.isOptional === "optional"
          : matches(field, fields[name]),
      );
    }
    default:
      return false;
  }
}

function read<V extends GenericValidator>(
  validator: V,
  value: unknown,
  what: string,
): Infer<V> {
  if (!matches(validator, value)) {
    throw new DecodeError(`WorkOS sent a ${what} this component cannot read`);
  }
  return value as Infer<V>;
}

function optional(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

function time(value: string, what: string): number {
  const at = Date.parse(value);
  if (Number.isNaN(at))
    throw new DecodeError(`WorkOS sent a ${what} with no readable time`);
  return at;
}

function domain(
  raw: Infer<typeof WireDomain>,
  organization: string,
  fallback: number,
): Domain {
  return {
    workosId: raw.id,
    domain: raw.domain.toLowerCase(),
    organization: raw.organization_id ?? organization,
    state: raw.state ?? "pending",
    at: raw.updated_at ? time(raw.updated_at, "domain") : fallback,
    deleted: false,
  };
}

function organization(value: unknown, deleted: number | null): Update {
  const raw = read(WireOrganization, value, "organization");
  const at = deleted ?? time(raw.updated_at, "organization");
  return {
    kind: "organization",
    row: {
      workosId: raw.id,
      name: raw.name,
      externalId: optional(raw.external_id),
      at,
      deleted: deleted !== null,
    },
    domains:
      deleted === null
        ? (raw.domains ?? []).map((item) => domain(item, raw.id, at))
        : [],
  };
}

function user(value: unknown, deleted: number | null): Update {
  const raw = read(WireUser, value, "user");
  return {
    kind: "user",
    row: {
      workosId: raw.id,
      email: raw.email.toLowerCase(),
      emailVerified: raw.email_verified,
      firstName: optional(raw.first_name),
      lastName: optional(raw.last_name),
      picture: optional(raw.profile_picture_url),
      externalId: optional(raw.external_id),
      at: deleted ?? time(raw.updated_at, "user"),
      deleted: deleted !== null,
    },
  };
}

function membership(value: unknown, deleted: number | null): Update {
  const raw = read(WireMembership, value, "organization membership");
  return {
    kind: "membership",
    row: {
      workosId: raw.id,
      user: raw.user_id,
      organization: raw.organization_id,
      role: raw.role.slug,
      status: raw.status,
      at: deleted ?? time(raw.updated_at, "organization membership"),
      deleted: deleted !== null,
    },
  };
}

function connection(value: unknown, deleted: number | null): Update {
  const raw = read(WireConnection, value, "connection");
  return {
    kind: "connection",
    row: {
      workosId: raw.id,
      organization: optional(raw.organization_id),
      type: raw.connection_type,
      state: raw.state,
      at: deleted ?? time(raw.updated_at, "connection"),
      deleted: deleted !== null,
    },
  };
}

function directory(value: unknown, deleted: number | null): Update {
  const raw = read(WireDirectory, value, "directory");
  return {
    kind: "directory",
    row: {
      workosId: raw.id,
      organization: optional(raw.organization_id),
      name: raw.name,
      type: raw.type,
      state: raw.state,
      at: deleted ?? time(raw.updated_at, "directory"),
      deleted: deleted !== null,
    },
  };
}

function directoryUser(value: unknown, deleted: number | null): Update {
  const raw = read(WireDirectoryUser, value, "directory user");
  return {
    kind: "directoryUser",
    row: {
      workosId: raw.id,
      directory: raw.directory_id,
      organization: optional(raw.organization_id),
      idpId: raw.idp_id,
      email: optional(raw.email?.toLowerCase()),
      firstName: optional(raw.first_name),
      lastName: optional(raw.last_name),
      state: raw.state,
      at: deleted ?? time(raw.updated_at, "directory user"),
      deleted: deleted !== null,
    },
  };
}

function directoryGroup(value: unknown, deleted: number | null): Update {
  const raw = read(WireGroup, value, "directory group");
  return {
    kind: "directoryGroup",
    row: {
      workosId: raw.id,
      directory: raw.directory_id,
      organization: optional(raw.organization_id),
      name: raw.name,
      at: deleted ?? time(raw.updated_at, "directory group"),
      deleted: deleted !== null,
    },
  };
}

function edge(value: unknown, at: number, removed: boolean): Update {
  const raw = read(WireEdge, value, "group membership");
  return {
    kind: "directoryMember",
    row: {
      directory: raw.directory_id,
      organization: optional(raw.group.organization_id),
      group: raw.group.id,
      user: raw.user.id,
      at,
      deleted: removed,
    },
  };
}

const WireFailed = v.object({ reason: text, organization_domain: v.any() });

function standalone(value: unknown, at: number, deleted: boolean): Update {
  const raw = read(WireDomain, value, "organization domain");
  if (!raw.organization_id)
    throw new DecodeError("WorkOS sent a domain with no organization");
  const row = domain(raw, raw.organization_id, at);
  return { kind: "domain", row: deleted ? { ...row, at, deleted: true } : row };
}

const HANDLED = new Set<string>(EVENTS);

function decodeEvent(raw: Infer<typeof WireEvent>): Event | null {
  const name = raw.event;
  if (!HANDLED.has(name)) return null;
  const at = time(raw.created_at, "event");
  const gone = name.endsWith(".deleted") ? at : null;
  const event = (update: Update, activated = false): Event => ({
    id: raw.id,
    at,
    activated,
    update,
  });
  if (name === "dsync.group.user_added")
    return event(edge(raw.data, at, false));
  if (name === "dsync.group.user_removed")
    return event(edge(raw.data, at, true));
  if (name === "dsync.activated") return event(directory(raw.data, null), true);
  if (name === "dsync.deleted") return event(directory(raw.data, at));
  if (name.startsWith("dsync.user."))
    return event(directoryUser(raw.data, gone));
  if (name.startsWith("dsync.group."))
    return event(directoryGroup(raw.data, gone));
  if (name.startsWith("organization_membership."))
    return event(membership(raw.data, gone));
  if (name === "organization_domain.verification_failed") {
    const failed = read(WireFailed, raw.data, "failed domain verification");
    return event(standalone(failed.organization_domain, at, false));
  }
  if (name.startsWith("organization_domain."))
    return event(standalone(raw.data, at, gone !== null));
  if (name.startsWith("organization."))
    return event(organization(raw.data, gone));
  if (name.startsWith("connection.")) return event(connection(raw.data, gone));
  return event(user(raw.data, gone));
}

// An event of a type the component does not handle is passed over: the cursor still moves past it.
export function decodeEvents(items: unknown[]): {
  events: Event[];
  last: string | null;
} {
  const events: Event[] = [];
  let last: string | null = null;
  for (const item of items) {
    const raw = read(WireEvent, item, "event");
    const event = decodeEvent(raw);
    if (event !== null) events.push(event);
    last = raw.id;
  }
  return { events, last };
}

export type Page = { items: unknown[]; after: string | null };

export function decodeList(value: unknown): Page {
  const raw = read(WireList, value, "list");
  return { items: raw.data, after: raw.list_metadata.after ?? null };
}

export function decodeItem(
  endpoint: Endpoint,
  value: unknown,
  group: string,
  at: number,
): Update {
  switch (endpoint) {
    case "organizations":
      return organization(value, null);
    case "users":
      return user(value, null);
    case "memberships":
      return membership(value, null);
    case "connections":
      return connection(value, null);
    case "directories":
      return directory(value, null);
    case "directoryUsers":
      return directoryUser(value, null);
    case "directoryGroups":
      return directoryGroup(value, null);
    case "groupMembers": {
      const raw = read(WireDirectoryUser, value, "directory user");
      return {
        kind: "directoryMember",
        row: {
          directory: raw.directory_id,
          organization: optional(raw.organization_id),
          group,
          user: raw.id,
          at,
          deleted: false,
        },
      };
    }
  }
}
