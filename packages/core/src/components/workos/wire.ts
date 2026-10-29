/**
 * Decoding what WorkOS's API sends: list pages, events, and the objects in
 * them. It is untrusted JSON, so each field the sync reads is checked before
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
 * One write to the copy, decoded from a listed object or an event. A write
 * with `deleted` removes the object. `updatedAt` is WorkOS's time for the
 * object, so an older write never replaces a newer row.
 */
export const vUpdate = v.union(
  v.object({
    kind: v.literal("organization"),
    row: vWorkosOrganization,
    domains: v.array(vWorkosDomain),
    updatedAt: v.number(),
    deleted: v.boolean(),
  }),
  v.object({
    kind: v.literal("domain"),
    row: vWorkosDomain,
    deleted: v.boolean(),
  }),
  v.object({
    kind: v.literal("connection"),
    row: vWorkosConnection,
    updatedAt: v.number(),
    deleted: v.boolean(),
  }),
  v.object({
    kind: v.literal("directory"),
    row: vWorkosDirectory,
    updatedAt: v.number(),
    deleted: v.boolean(),
  }),
  v.object({
    kind: v.literal("user"),
    row: vWorkosDirectoryUser,
    updatedAt: v.number(),
    deleted: v.boolean(),
  }),
  v.object({
    kind: v.literal("group"),
    row: vWorkosDirectoryGroup,
    updatedAt: v.number(),
    deleted: v.boolean(),
  }),
  v.object({
    kind: v.literal("member"),
    row: vWorkosDirectoryMember,
    deleted: v.boolean(),
  }),
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

/**
 * The object's `updated_at`. An event's object falls back to the event's own
 * time, so a deletion whose object omits it still applies.
 */
function time(object: Fields, what: string, fallback?: number): number {
  const at = Date.parse(optionalText(object, "updated_at") ?? "");
  if (!Number.isNaN(at)) return at;
  if (fallback !== undefined) return fallback;
  throw new DecodeError(
    `WorkOS sent a ${what} with no readable \`updated_at\``,
  );
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

function organization(value: unknown, deleted: boolean, at?: number): Update {
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
    domains:
      !deleted && Array.isArray(domains)
        ? domains.map((item) => domain(item, id))
        : [],
    updatedAt: time(raw, "organization", at),
    deleted,
  };
}

function connection(value: unknown, deleted: boolean, at?: number): Update {
  const raw = fields(value, "connection");
  return {
    kind: "connection",
    row: {
      id: text(raw, "id", "connection"),
      organizationId: optionalText(raw, "organization_id"),
      type: text(raw, "connection_type", "connection"),
      state: text(raw, "state", "connection"),
    },
    updatedAt: time(raw, "connection", at),
    deleted,
  };
}

function directory(value: unknown, deleted: boolean, at?: number): Update {
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
    updatedAt: time(raw, "directory", at),
    deleted,
  };
}

function user(value: unknown, deleted: boolean, at?: number): Update {
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
    updatedAt: time(raw, "directory user", at),
    deleted,
  };
}

function group(value: unknown, deleted: boolean, at?: number): Update {
  const raw = fields(value, "directory group");
  return {
    kind: "group",
    row: {
      id: text(raw, "id", "directory group"),
      directoryId: text(raw, "directory_id", "directory group"),
      organizationId: optionalText(raw, "organization_id"),
      name: text(raw, "name", "directory group"),
    },
    updatedAt: time(raw, "directory group", at),
    deleted,
  };
}

function membership(value: unknown, removed: boolean): Update {
  const raw = fields(value, "group membership");
  return {
    kind: "member",
    row: {
      directoryId: text(raw, "directory_id", "group membership"),
      groupId: text(fields(raw.group, "group"), "id", "group"),
      userId: text(fields(raw.user, "user"), "id", "user"),
    },
    deleted: removed,
  };
}

const HANDLED = new Set<string>(EVENTS);

function event(name: string, data: unknown, at: number): Update {
  const deleted = name.endsWith(".deleted");
  if (name === "dsync.group.user_added") return membership(data, false);
  if (name === "dsync.group.user_removed") return membership(data, true);
  if (name === "dsync.activated" || name === "dsync.deleted") {
    return directory(data, deleted, at);
  }
  if (name.startsWith("dsync.user.")) return user(data, deleted, at);
  if (name.startsWith("dsync.group.")) return group(data, deleted, at);
  if (name === "organization_domain.verification_failed") {
    const failed = fields(data, "failed domain verification");
    return { kind: "domain", row: domain(failed.organization_domain), deleted };
  }
  if (name.startsWith("organization_domain.")) {
    return { kind: "domain", row: domain(data), deleted };
  }
  if (name.startsWith("organization.")) return organization(data, deleted, at);
  return connection(data, deleted, at);
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
 * A page of events, decoded. An event of a type the sync does not handle is
 * passed over, but the cursor still moves past it.
 */
export function decodeEvents(items: unknown[]): {
  updates: Update[];
  last: string | undefined;
} {
  const updates: Update[] = [];
  let last: string | undefined;
  for (const item of items) {
    const raw = fields(item, "event");
    const name = text(raw, "event", "event");
    if (HANDLED.has(name)) {
      const at = Date.parse(optionalText(raw, "created_at") ?? "");
      updates.push(event(name, raw.data, Number.isNaN(at) ? Date.now() : at));
    }
    last = text(raw, "id", "event");
  }
  return { updates, last };
}

/** What a backfill listing holds, decoded as the write it makes. */
export function decodeListed(
  stage: "organizations" | "connections" | "directories" | "users" | "groups",
  value: unknown,
): Update {
  switch (stage) {
    case "organizations":
      return organization(value, false);
    case "connections":
      return connection(value, false);
    case "directories":
      return directory(value, false);
    case "users":
      return user(value, false);
    case "groups":
      return group(value, false);
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
    deleted: false,
  };
}
