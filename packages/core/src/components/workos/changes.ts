/**
 * The shapes the directory sync copies and hands to the app.
 *
 * Each copied WorkOS object is a row of this component's own tables, minus
 * its bookkeeping. A change is what the app's handler receives: the object
 * after the change, and whether it was upserted or removed.
 *
 * @module
 */
import { Infer, v } from "convex/values";
import schema from "./schema.ts";

/** The kinds of WorkOS object an app handler can receive changes for. */
export const vChangeKind = v.union(
  v.literal("organization"),
  v.literal("membership"),
  v.literal("user"),
  v.literal("connection"),
  v.literal("directory"),
  v.literal("directoryUser"),
  v.literal("directoryGroup"),
  v.literal("directoryMember"),
);
export type ChangeKind = Infer<typeof vChangeKind>;

/**
 * `"remove"` carries the tombstone: the object as it was, with
 * `deleted: true` and the time it went.
 */
export const vChangeOperation = v.union(
  v.literal("upsert"),
  v.literal("remove"),
);
export type ChangeOperation = Infer<typeof vChangeOperation>;

export const vOrganization = schema.tables.organizations.validator.omit("seen");
export type Organization = Infer<typeof vOrganization>;
export const vDomain = schema.tables.domains.validator.omit("seen");
export type Domain = Infer<typeof vDomain>;
export const vConnection = schema.tables.connections.validator.omit("seen");
export type Connection = Infer<typeof vConnection>;
export const vUser = schema.tables.users.validator.omit("seen");
export type User = Infer<typeof vUser>;
export const vMembership = schema.tables.memberships.validator.omit("seen");
export type Membership = Infer<typeof vMembership>;
export const vDirectory = schema.tables.directories.validator.omit("seen");
export type Directory = Infer<typeof vDirectory>;
export const vDirectoryUser =
  schema.tables.directoryUsers.validator.omit("seen");
export type DirectoryUser = Infer<typeof vDirectoryUser>;
export const vDirectoryGroup =
  schema.tables.directoryGroups.validator.omit("seen");
export type DirectoryGroup = Infer<typeof vDirectoryGroup>;
export const vDirectoryMember =
  schema.tables.directoryMembers.validator.omit("seen");
export type DirectoryMember = Infer<typeof vDirectoryMember>;

export const vOrganizationChange = v.object({
  kind: vChangeOperation,
  after: vOrganization,
});
export type OrganizationChange = Infer<typeof vOrganizationChange>;
export const vMembershipChange = v.object({
  kind: vChangeOperation,
  after: vMembership,
});
export type MembershipChange = Infer<typeof vMembershipChange>;
export const vUserChange = v.object({ kind: vChangeOperation, after: vUser });
export type UserChange = Infer<typeof vUserChange>;
export const vConnectionChange = v.object({
  kind: vChangeOperation,
  after: vConnection,
});
export type ConnectionChange = Infer<typeof vConnectionChange>;
export const vDirectoryChange = v.object({
  kind: vChangeOperation,
  after: vDirectory,
});
export type DirectoryChange = Infer<typeof vDirectoryChange>;
export const vDirectoryUserChange = v.object({
  kind: vChangeOperation,
  after: vDirectoryUser,
});
export type DirectoryUserChange = Infer<typeof vDirectoryUserChange>;
export const vDirectoryGroupChange = v.object({
  kind: vChangeOperation,
  after: vDirectoryGroup,
});
export type DirectoryGroupChange = Infer<typeof vDirectoryGroupChange>;
export const vDirectoryMemberChange = v.object({
  kind: vChangeOperation,
  after: vDirectoryMember,
});
export type DirectoryMemberChange = Infer<typeof vDirectoryMemberChange>;

/** One decoded WorkOS object, as an event or a listing delivers it. */
export const vUpdate = v.union(
  v.object({
    kind: v.literal("organization"),
    row: vOrganization,
    domains: v.array(vDomain),
  }),
  v.object({ kind: v.literal("domain"), row: vDomain }),
  v.object({ kind: v.literal("membership"), row: vMembership }),
  v.object({ kind: v.literal("user"), row: vUser }),
  v.object({ kind: v.literal("connection"), row: vConnection }),
  v.object({ kind: v.literal("directory"), row: vDirectory }),
  v.object({ kind: v.literal("directoryUser"), row: vDirectoryUser }),
  v.object({ kind: v.literal("directoryGroup"), row: vDirectoryGroup }),
  v.object({ kind: v.literal("directoryMember"), row: vDirectoryMember }),
);
export type Update = Infer<typeof vUpdate>;

/**
 * One decoded event. `activated` marks a directory's `dsync.activated`, which
 * starts that directory's backfill.
 */
export const vEvent = v.object({
  id: v.string(),
  at: v.number(),
  activated: v.boolean(),
  update: vUpdate,
});
export type Event = Infer<typeof vEvent>;

/**
 * The app's handlers, as function handles by kind. Only the app can mint a
 * function handle, so every call that may write the copy carries them.
 */
export const vHandles = v.object({
  organization: v.optional(v.string()),
  membership: v.optional(v.string()),
  user: v.optional(v.string()),
  connection: v.optional(v.string()),
  directory: v.optional(v.string()),
  directoryUser: v.optional(v.string()),
  directoryGroup: v.optional(v.string()),
  directoryMember: v.optional(v.string()),
});
export type Handles = Infer<typeof vHandles>;
