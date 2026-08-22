import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { vAuthGroupId, vAuthUserId } from "./auth/ids";

export const projectStatus = v.union(v.literal("active"), v.literal("archived"));

export const issueStatus = v.union(
  v.literal("backlog"),
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("done"),
  v.literal("cancelled"),
);

export const issuePriority = v.union(
  v.literal("urgent"),
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
  v.literal("none"),
);

export default defineSchema({
  projects: defineTable({
    groupId: vAuthGroupId,
    name: v.string(),
    identifier: v.string(),
    slug: v.string(),
    description: v.string(),
    status: projectStatus,
    createdByUserId: vAuthUserId,
    issueCounter: v.number(),
    openIssueCount: v.optional(v.number()),
  })
    .index("by_groupId", ["groupId"])
    .index("by_groupId_and_slug", ["groupId", "slug"])
    .index("by_groupId_and_identifier", ["groupId", "identifier"]),

  issues: defineTable({
    projectId: v.id("projects"),
    groupId: vAuthGroupId,
    scopeGroupId: vAuthGroupId,
    number: v.number(),
    title: v.string(),
    description: v.optional(v.string()),
    status: issueStatus,
    priority: issuePriority,
    assigneeUserId: v.optional(vAuthUserId),
    createdByUserId: vAuthUserId,
    labels: v.optional(v.array(v.string())),
    position: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_position", ["projectId", "position"])
    .index("by_projectId_and_status", ["projectId", "status"])
    .index("by_groupId", ["groupId"])
    .index("by_assigneeUserId", ["assigneeUserId"]),

  comments: defineTable({
    issueId: v.id("issues"),
    groupId: vAuthGroupId,
    authorUserId: vAuthUserId,
    body: v.string(),
  }).index("by_issueId", ["issueId"]),
});
