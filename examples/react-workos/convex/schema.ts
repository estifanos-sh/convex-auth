import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // `workosId` is the WorkOS user id (`provider.accountId` at sign-up), what
  // revoking WorkOS sessions and the members table key on.
  users: defineTable({ workosId: v.string() }).index("by_workosId", [
    "workosId",
  ]),
  // The app's own view of its customers' WorkOS organizations, kept by the
  // directory sync's handlers in workos.ts.
  organizations: defineTable({
    workosId: v.string(),
    name: v.string(),
  }).index("by_workosId", ["workosId"]),
  members: defineTable({
    membershipId: v.string(),
    organization: v.string(),
    workosUser: v.string(),
    role: v.string(),
  })
    .index("by_membershipId", ["membershipId"])
    .index("by_workosUser", ["workosUser"]),
});
