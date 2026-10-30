import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";
import {
  authorizationRequestsTable,
  ticketsTable,
} from "../../lib/oauth/schema.ts";

/**
 * The shapes of the WorkOS objects the directory sync keeps, as the app reads
 * them and as its change handler receives them. `id` is WorkOS's id.
 */
export const vWorkosOrganization = v.object({
  id: v.string(),
  name: v.string(),
  externalId: v.optional(v.string()),
});
export type WorkosOrganization = Infer<typeof vWorkosOrganization>;

export const vWorkosDomain = v.object({
  id: v.string(),
  organizationId: v.string(),
  /** Lowercased. */
  domain: v.string(),
  /** WorkOS's state, e.g. `"verified"` or `"pending"`. */
  state: v.string(),
});
export type WorkosDomain = Infer<typeof vWorkosDomain>;

export const vWorkosConnection = v.object({
  id: v.string(),
  organizationId: v.optional(v.string()),
  /** e.g. `"OktaSAML"`. */
  type: v.string(),
  /** e.g. `"active"` or `"inactive"`. */
  state: v.string(),
});
export type WorkosConnection = Infer<typeof vWorkosConnection>;

export const vWorkosDirectory = v.object({
  id: v.string(),
  organizationId: v.optional(v.string()),
  name: v.string(),
  /** e.g. `"okta scim v2.0"`. */
  type: v.string(),
  /** e.g. `"linked"`. */
  state: v.string(),
});
export type WorkosDirectory = Infer<typeof vWorkosDirectory>;

export const vWorkosDirectoryUser = v.object({
  id: v.string(),
  directoryId: v.string(),
  organizationId: v.optional(v.string()),
  /** The user's id at the identity provider, the same `idpId` SSO returns. */
  idpId: v.string(),
  /** Lowercased. */
  email: v.optional(v.string()),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  /** `"active"`, or `"inactive"` once the directory deprovisioned the user. */
  state: v.string(),
});
export type WorkosDirectoryUser = Infer<typeof vWorkosDirectoryUser>;

export const vWorkosDirectoryGroup = v.object({
  id: v.string(),
  directoryId: v.string(),
  organizationId: v.optional(v.string()),
  name: v.string(),
});
export type WorkosDirectoryGroup = Infer<typeof vWorkosDirectoryGroup>;

export const vWorkosDirectoryMember = v.object({
  directoryId: v.string(),
  groupId: v.string(),
  userId: v.string(),
});
export type WorkosDirectoryMember = Infer<typeof vWorkosDirectoryMember>;

const vWritten = v.union(v.literal("upserted"), v.literal("deleted"));

/**
 * One change the directory sync made to its copy, as the app's handler
 * receives it. Changes arrive in the order WorkOS made them, and a change
 * that changes nothing is not delivered.
 *
 * A `user` change carries `deprovisioned`: true when the directory deleted
 * the user or marked them inactive. That is the signal to revoke the app
 * user's sessions.
 */
export const vWorkosDirectoryChange = v.union(
  v.object({
    kind: v.literal("organization"),
    action: vWritten,
    organization: vWorkosOrganization,
  }),
  v.object({
    kind: v.literal("domain"),
    action: vWritten,
    domain: vWorkosDomain,
  }),
  v.object({
    kind: v.literal("connection"),
    action: vWritten,
    connection: vWorkosConnection,
  }),
  v.object({
    kind: v.literal("directory"),
    action: vWritten,
    directory: vWorkosDirectory,
  }),
  v.object({
    kind: v.literal("user"),
    action: vWritten,
    user: vWorkosDirectoryUser,
    deprovisioned: v.boolean(),
  }),
  v.object({
    kind: v.literal("group"),
    action: vWritten,
    group: vWorkosDirectoryGroup,
  }),
  v.object({
    kind: v.literal("member"),
    action: v.union(v.literal("added"), v.literal("removed")),
    member: vWorkosDirectoryMember,
  }),
);
export type WorkosDirectoryChange = Infer<typeof vWorkosDirectoryChange>;

/**
 * Where a reconcile is: the listing it is on, the directory and group the
 * listing is scoped to, and WorkOS's cursor within it.
 */
export const vBackfillPosition = v.union(
  v.object({
    stage: v.union(
      v.literal("organizations"),
      v.literal("connections"),
      v.literal("directories"),
    ),
    after: v.optional(v.string()),
  }),
  v.object({
    stage: v.union(v.literal("users"), v.literal("groups")),
    directoryId: v.string(),
    after: v.optional(v.string()),
  }),
  v.object({
    stage: v.literal("members"),
    directoryId: v.string(),
    groupId: v.string(),
    after: v.optional(v.string()),
  }),
);
export type BackfillPosition = Infer<typeof vBackfillPosition>;

/**
 * Every row carries the time it was last written or listed. A reconcile that
 * started at time T ends by removing the rows older than T, which is how the
 * copy drops what WorkOS deleted while its webhook deliveries were missed.
 */
const kept = {
  generation: v.number(),
};

/** The time WorkOS last changed the object, so an older write never lands. */
const stamped = {
  ...kept,
  updatedAt: v.number(),
};

export default defineSchema({
  authorizationRequests: authorizationRequestsTable,
  tickets: ticketsTable,

  organizations: defineTable({
    ...vWorkosOrganization.fields,
    ...stamped,
  })
    .index("id", ["id"])
    .index("generation", ["generation"]),
  domains: defineTable({ ...vWorkosDomain.fields, ...kept })
    .index("id", ["id"])
    .index("domain", ["domain"])
    .index("organizationId", ["organizationId"])
    .index("generation", ["generation"]),
  connections: defineTable({ ...vWorkosConnection.fields, ...stamped })
    .index("id", ["id"])
    .index("organizationId_state", ["organizationId", "state"])
    .index("generation", ["generation"]),
  directories: defineTable({
    ...vWorkosDirectory.fields,
    ...stamped,
    /**
     * Set when WorkOS deleted the directory. The row stays until `sweep` has
     * removed its users, groups and members, a page at a time.
     */
    deleted: v.optional(v.boolean()),
  })
    .index("id", ["id"])
    .index("organizationId", ["organizationId"])
    .index("deleted", ["deleted"])
    .index("generation", ["generation"]),
  directoryUsers: defineTable({ ...vWorkosDirectoryUser.fields, ...stamped })
    .index("id", ["id"])
    .index("directoryId", ["directoryId"])
    .index("organizationId_idpId", ["organizationId", "idpId"])
    .index("generation", ["generation"]),
  directoryGroups: defineTable({
    ...vWorkosDirectoryGroup.fields,
    ...stamped,
  })
    .index("id", ["id"])
    .index("directoryId_id", ["directoryId", "id"])
    .index("generation", ["generation"]),
  directoryMembers: defineTable({ ...vWorkosDirectoryMember.fields, ...kept })
    .index("groupId_userId", ["groupId", "userId"])
    .index("userId", ["userId"])
    .index("directoryId", ["directoryId"])
    .index("generation", ["generation"]),

  /**
   * The deployment's one webhook endpoint at WorkOS, which `webhook.register`
   * creates, the secret WorkOS signs its deliveries with, and the app's
   * change handler, as a function handle.
   */
  webhook: defineTable({
    endpointId: v.string(),
    url: v.string(),
    secret: v.string(),
    onChange: v.string(),
  }),
});
