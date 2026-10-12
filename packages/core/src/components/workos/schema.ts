import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";
import { vWorkId } from "@convex-dev/workpool";
import {
  authorizationRequestsTable,
  ticketsTable,
} from "../../lib/oauth/schema.ts";

/** A WorkOS organization membership's status. */
export const vMembershipStatus = v.union(
  v.literal("active"),
  v.literal("inactive"),
  v.literal("pending"),
);
export type MembershipStatus = Infer<typeof vMembershipStatus>;

/**
 * What a backfill lists and reconciles: every organization or user, or the
 * children of one organization, directory, group or directory user.
 */
export const vBackfillScope = v.union(
  v.literal("organizations"),
  v.literal("users"),
  v.literal("organization"),
  v.literal("directory"),
  v.literal("group"),
  v.literal("user"),
);
export type BackfillScope = Infer<typeof vBackfillScope>;

/**
 * Why the directory sync stopped. `credentials`, `rejected`, `callback` and
 * `decode` wait for a fix and the next sync; `expired` restarts from a fresh
 * boundary; `transient` ran out of the lane's retries.
 */
export const vSyncFailure = v.object({
  kind: v.union(
    v.literal("credentials"),
    v.literal("expired"),
    v.literal("rejected"),
    v.literal("callback"),
    v.literal("decode"),
    v.literal("transient"),
  ),
  event: v.optional(v.string()),
  detail: v.optional(v.string()),
  key: v.optional(v.string()),
});
export type SyncFailure = Infer<typeof vSyncFailure>;

/**
 * Every copied WorkOS object carries its WorkOS time, a tombstone flag, and
 * the backfill that last listed it.
 */
const copied = {
  workosId: v.string(),
  at: v.number(),
  deleted: v.boolean(),
  seen: v.optional(v.id("backfills")),
};

export default defineSchema({
  authorizationRequests: authorizationRequestsTable,
  tickets: ticketsTable,

  // The copy of the WorkOS environment the directory sync keeps.
  organizations: defineTable({
    ...copied,
    name: v.string(),
    externalId: v.optional(v.string()),
  }).index("by_workosId", ["workosId"]),
  domains: defineTable({
    ...copied,
    domain: v.string(),
    organization: v.string(),
    state: v.string(),
  })
    .index("by_workosId", ["workosId"])
    .index("by_domain_deleted_state", ["domain", "deleted", "state"])
    .index("by_organization", ["organization"]),
  connections: defineTable({
    ...copied,
    organization: v.optional(v.string()),
    type: v.string(),
    state: v.string(),
  })
    .index("by_workosId", ["workosId"])
    .index("by_organization", ["organization"])
    .index("by_organization_deleted_state", [
      "organization",
      "deleted",
      "state",
    ]),
  users: defineTable({
    ...copied,
    email: v.string(),
    emailVerified: v.boolean(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    picture: v.optional(v.string()),
    externalId: v.optional(v.string()),
  }).index("by_workosId", ["workosId"]),
  memberships: defineTable({
    ...copied,
    user: v.string(),
    organization: v.string(),
    role: v.string(),
    status: vMembershipStatus,
  })
    .index("by_workosId", ["workosId"])
    .index("by_organization", ["organization"])
    .index("by_user_deleted", ["user", "deleted"])
    .index("by_organization_deleted", ["organization", "deleted"]),
  directories: defineTable({
    ...copied,
    organization: v.optional(v.string()),
    name: v.string(),
    type: v.string(),
    state: v.string(),
  })
    .index("by_workosId", ["workosId"])
    .index("by_organization", ["organization"]),
  directoryUsers: defineTable({
    ...copied,
    directory: v.string(),
    organization: v.optional(v.string()),
    idpId: v.string(),
    email: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    state: v.string(),
  })
    .index("by_workosId", ["workosId"])
    .index("by_directory", ["directory"])
    .index("by_organization", ["organization"]),
  directoryGroups: defineTable({
    ...copied,
    directory: v.string(),
    organization: v.optional(v.string()),
    name: v.string(),
  })
    .index("by_workosId", ["workosId"])
    .index("by_directory", ["directory"])
    .index("by_organization", ["organization"]),
  directoryMembers: defineTable({
    directory: v.string(),
    organization: v.optional(v.string()),
    group: v.string(),
    user: v.string(),
    at: v.number(),
    deleted: v.boolean(),
    seen: v.optional(v.id("backfills")),
  })
    .index("by_group_user", ["group", "user"])
    .index("by_group_deleted", ["group", "deleted"])
    .index("by_user", ["user"])
    .index("by_directory", ["directory"])
    .index("by_organization", ["organization"]),

  // The directory sync's own state: the one event stream position, and the
  // listings that fill and reconcile the copy.
  eventStream: defineTable({
    bounded: v.boolean(),
    cursor: v.union(v.string(), v.null()),
    since: v.optional(v.number()),
    work: v.optional(vWorkId),
    again: v.optional(v.boolean()),
    error: v.optional(vSyncFailure),
  }),
  backfills: defineTable({
    scope: vBackfillScope,
    target: v.optional(v.string()),
    phase: v.union(
      v.literal("list"),
      v.literal("reconcile"),
      v.literal("done"),
    ),
    step: v.number(),
    after: v.optional(v.string()),
    startedAt: v.number(),
    work: v.optional(vWorkId),
  })
    .index("by_phase", ["phase"])
    .index("by_scope_target", ["scope", "target"]),
});
