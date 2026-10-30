/**
 * Decoding what WorkOS's API sends: list pages, events, and the objects in
 * them. It is untrusted JSON, so each field the copy reads is checked before
 * it is used, and anything else fails as a {@link DecodeError}. Fields WorkOS
 * adds over time are ignored.
 *
 * @module
 */
import { Infer, v } from "convex/values";
import {
  vWorkosConnection,
  vWorkosDirectory,
  vWorkosDirectoryGroup,
  vWorkosDirectoryMember,
  vWorkosDirectoryUser,
  vWorkosDomain,
  vWorkosOrganization,
  type WorkosDomain,
} from "./schema.ts";
import { EVENTS } from "./constants.ts";

export class DecodeError extends Error {
  override readonly name = "DecodeError";
}

/**
 * One object as WorkOS holds it now, decoded from a listing or a read by id,
 * as the write it makes to the copy.
 */
export const vUpdate = v.union(
  v.object({
    kind: v.literal("organization"),
    row: vWorkosOrganization,
    domains: v.array(vWorkosDomain),
  }),
  v.object({ kind: v.literal("domain"), row: vWorkosDomain }),
  v.object({ kind: v.literal("connection"), row: vWorkosConnection }),
  v.object({ kind: v.literal("directory"), row: vWorkosDirectory }),
  v.object({ kind: v.literal("user"), row: vWorkosDirectoryUser }),
  v.object({ kind: v.literal("group"), row: vWorkosDirectoryGroup }),
  v.object({ kind: v.literal("member"), row: vWorkosDirectoryMember }),
);
export type Update = Infer<typeof vUpdate>;

type Fields = Record<string, unknown>;

function fields(value: unknown, what: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError(`WorkOS sent a ${what} that is not an object`);
  }
  return Object.fromEntries(Object.entries(value));
}

function text(object: Fields, name: string, what: string): string {
  const value = object[name];
  if (typeof value !== "string") {
    throw new DecodeError(`WorkOS sent a ${what} with no \`${name}\``);
  }
  return value;
}

function optionalText(object: Fields, name: string): string | undefined {
  const value = object[name];
  return typeof value === "string" ? value : undefined;
}

function domain(value: unknown, organizationId?: string): WorkosDomain {
  const raw = fields(value, "domain");
  const owner = optionalText(raw, "organization_id") ?? organizationId;
  if (owner === undefined) {
    throw new DecodeError("WorkOS sent a domain with no organization");
  }
  return {
    id: text(raw, "id", "domain"),
    organizationId: owner,
    domain: text(raw, "domain", "domain").toLowerCase(),
    state: optionalText(raw, "state") ?? "pending",
  };
}

function organization(value: unknown): Update {
  const raw = fields(value, "organization");
  const id = text(raw, "id", "organization");
  const domains = raw.domains;
  return {
    kind: "organization",
    row: {
      id,
      name: text(raw, "name", "organization"),
      externalId: optionalText(raw, "external_id"),
    },
    domains: Array.isArray(domains)
      ? domains.map((item) => domain(item, id))
      : [],
  };
}

function connection(value: unknown): Update {
  const raw = fields(value, "connection");
  return {
    kind: "connection",
    row: {
      id: text(raw, "id", "connection"),
      organizationId: optionalText(raw, "organization_id"),
      type: text(raw, "connection_type", "connection"),
      state: text(raw, "state", "connection"),
    },
  };
}

function directory(value: unknown): Update {
  const raw = fields(value, "directory");
  return {
    kind: "directory",
    row: {
      id: text(raw, "id", "directory"),
      organizationId: optionalText(raw, "organization_id"),
      name: text(raw, "name", "directory"),
      type: text(raw, "type", "directory"),
      state: text(raw, "state", "directory"),
    },
  };
}

function user(value: unknown): Update {
  const raw = fields(value, "directory user");
  return {
    kind: "user",
    row: {
      id: text(raw, "id", "directory user"),
      directoryId: text(raw, "directory_id", "directory user"),
      organizationId: optionalText(raw, "organization_id"),
      idpId: text(raw, "idp_id", "directory user"),
      email: optionalText(raw, "email")?.toLowerCase(),
      firstName: optionalText(raw, "first_name"),
      lastName: optionalText(raw, "last_name"),
      state: text(raw, "state", "directory user"),
    },
  };
}

function group(value: unknown): Update {
  const raw = fields(value, "directory group");
  return {
    kind: "group",
    row: {
      id: text(raw, "id", "directory group"),
      directoryId: text(raw, "directory_id", "directory group"),
      organizationId: optionalText(raw, "organization_id"),
      name: text(raw, "name", "directory group"),
    },
  };
}

const HANDLED = new Set<string>(EVENTS);

/** A kind of object WorkOS reads by id. */
export const vKind = v.union(
  v.literal("organization"),
  v.literal("domain"),
  v.literal("connection"),
  v.literal("directory"),
  v.literal("user"),
  v.literal("group"),
);
export type Kind = Infer<typeof vKind>;

/** An object a webhook delivery says changed, to be read again. */
export type Target =
  | { kind: Kind; id: string }
  | { kind: "members"; directoryId: string; groupId: string };

function target(name: string, data: unknown): Target {
  const raw = fields(data, "event object");
  if (
    name === "dsync.group.user_added" ||
    name === "dsync.group.user_removed"
  ) {
    return {
      kind: "members",
      directoryId: text(raw, "directory_id", "group membership"),
      groupId: text(fields(raw.group, "group"), "id", "group"),
    };
  }
  if (name === "organization_domain.verification_failed") {
    const failed = fields(raw.organization_domain, "domain");
    return { kind: "domain", id: text(failed, "id", "domain") };
  }
  const id = text(raw, "id", "event object");
  if (name === "dsync.activated" || name === "dsync.deleted") {
    return { kind: "directory", id };
  }
  if (name.startsWith("dsync.user.")) return { kind: "user", id };
  if (name.startsWith("dsync.group.")) return { kind: "group", id };
  if (name.startsWith("organization_domain.")) return { kind: "domain", id };
  if (name.startsWith("organization.")) return { kind: "organization", id };
  return { kind: "connection", id };
}

/** A list page: its objects, and the cursor of the next page if any. */
export function decodeList(value: unknown): {
  items: unknown[];
  after: string | undefined;
} {
  const raw = fields(value, "list");
  if (!Array.isArray(raw.data)) {
    throw new DecodeError("WorkOS sent a list with no `data`");
  }
  const metadata = fields(raw.list_metadata, "list metadata");
  return { items: raw.data, after: optionalText(metadata, "after") };
}

/**
 * The object a webhook delivery names, or null for an event the copy does
 * not keep. The delivery's payload is not applied: WorkOS does not deliver in
 * order, so the object is read again as it is now.
 */
export function decodeEvent(value: unknown): Target | null {
  const raw = fields(value, "event");
  const name = text(raw, "event", "event");
  if (!HANDLED.has(name)) return null;
  return target(name, raw.data);
}

/** The path that reads one object by id. */
export function objectPath(kind: Kind, id: string): string {
  const collection = {
    organization: "organizations",
    domain: "organization_domains",
    connection: "connections",
    directory: "directories",
    user: "directory_users",
    group: "directory_groups",
  }[kind];
  return `/${collection}/${encodeURIComponent(id)}`;
}

/** One object read by id, decoded as the write it makes. */
export function decodeObject(kind: Kind, value: unknown): Update {
  switch (kind) {
    case "organization":
      return organization(value);
    case "domain":
      return { kind: "domain", row: domain(value) };
    case "connection":
      return connection(value);
    case "directory":
      return directory(value);
    case "user":
      return user(value);
    case "group":
      return group(value);
  }
}

/** What a reconcile listing holds, decoded as the write it makes. */
export function decodeListed(
  stage: "organizations" | "connections" | "directories" | "users" | "groups",
  value: unknown,
): Update {
  switch (stage) {
    case "organizations":
      return organization(value);
    case "connections":
      return connection(value);
    case "directories":
      return directory(value);
    case "users":
      return user(value);
    case "groups":
      return group(value);
  }
}

/** A directory user listed by group, decoded as the membership it shows. */
export function decodeMember(value: unknown, groupId: string): Update {
  const raw = fields(value, "directory user");
  return {
    kind: "member",
    row: {
      directoryId: text(raw, "directory_id", "directory user"),
      groupId,
      userId: text(raw, "id", "directory user"),
    },
  };
}

/** A webhook endpoint, from WorkOS's `/webhook_endpoints` API. */
export function decodeEndpoint(value: unknown): {
  id: string;
  url: string;
  secret: string;
  enabled: boolean;
  events: string[];
} {
  const raw = fields(value, "webhook endpoint");
  const events = Array.isArray(raw.events)
    ? raw.events.filter((event) => typeof event === "string")
    : [];
  return {
    id: text(raw, "id", "webhook endpoint"),
    url: text(raw, "endpoint_url", "webhook endpoint"),
    secret: text(raw, "secret", "webhook endpoint"),
    enabled: optionalText(raw, "status") === "enabled",
    events,
  };
}
