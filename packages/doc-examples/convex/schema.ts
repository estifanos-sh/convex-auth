import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({ workosId: v.optional(v.string()) }).index("workosId", [
    "workosId",
  ]),
});
