import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

import { auth } from "./auth";
import { vAuthGroupId, vAuthUserId } from "./auth/ids";
import { ErrorCode } from "./errors";
import { authMutation, authQuery } from "./functions";
import { issuePriority, issueStatus, projectStatus } from "./schema";

type UserLookup = { name?: string; email?: string } | null;

function toIssueView(
  project: Doc<"projects">,
  issue: Doc<"issues">,
  userMap: Map<Doc<"issues">["createdByUserId"], UserLookup>,
) {
  const assignee = issue.assigneeUserId ? userMap.get(issue.assigneeUserId) : null;
  const creator = userMap.get(issue.createdByUserId);
  return {
    _id: issue._id,
    identifier: `${project.identifier}-${issue.number}`,
    number: issue.number,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    labels: issue.labels ?? [],
    assigneeName: assignee ? (assignee.name ?? assignee.email ?? null) : null,
    assigneeUserId: issue.assigneeUserId ?? null,
    createdByName: creator?.name ?? creator?.email ?? "Unknown",
    createdByUserId: issue.createdByUserId,
    projectId: issue.projectId,
    groupId: issue.groupId,
  };
}

const vIssue = v.object({
  _id: v.id("issues"),
  identifier: v.string(),
  number: v.number(),
  title: v.string(),
  status: issueStatus,
  priority: issuePriority,
  labels: v.array(v.string()),
  assigneeName: v.union(v.string(), v.null()),
  assigneeUserId: v.union(vAuthUserId, v.null()),
  createdByName: v.string(),
  createdByUserId: vAuthUserId,
  projectId: v.id("projects"),
  groupId: vAuthGroupId,
});

const DEFAULT_ISSUE_PAGE_SIZE = 50;
const ISSUE_DELETE_COMMENT_LIMIT = 100;

export const list = authQuery({
  args: {
    projectId: v.id("projects"),
    paginationOpts: v.optional(paginationOptsValidator),
  },
  returns: v.object({
    project: v.union(
      v.object({
        _id: v.id("projects"),
        groupId: vAuthGroupId,
        name: v.string(),
        identifier: v.string(),
        slug: v.string(),
        description: v.string(),
        status: projectStatus,
        issueCounter: v.number(),
        openIssueCount: v.number(),
      }),
      v.null(),
    ),
    issues: v.array(vIssue),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) {
      return { project: null, issues: [], isDone: true, continueCursor: "" };
    }
    const userId = ctx.auth.userId;

    await auth.member.assert(ctx, {
      userId,
      groupId: project.groupId,
      grants: ["projects.read"],
    });

    const result = await ctx.db
      .query("issues")
      .withIndex("by_projectId_and_position", (q) => q.eq("projectId", project._id))
      .paginate(args.paginationOpts ?? { numItems: DEFAULT_ISSUE_PAGE_SIZE, cursor: null });
    const issues = result.page;

    const allUserIds = Array.from(
      new Set(
        issues.flatMap((issue) =>
          issue.assigneeUserId === undefined
            ? [issue.createdByUserId]
            : [issue.createdByUserId, issue.assigneeUserId],
        ),
      ),
    );
    const userDocs = await auth.user.get(ctx, { ids: allUserIds });
    const userMap = new Map<Doc<"issues">["createdByUserId"], UserLookup>(
      allUserIds.map((id, i) => [id, userDocs[i]]),
    );

    return {
      project: {
        _id: project._id,
        groupId: project.groupId,
        name: project.name,
        identifier: project.identifier,
        slug: project.slug,
        description: project.description,
        status: project.status,
        issueCounter: project.issueCounter,
        openIssueCount: project.openIssueCount ?? 0,
      },
      issues: issues.map((issue) => toIssueView(project, issue, userMap)),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const get = authQuery({
  args: { issueId: v.id("issues") },
  returns: v.union(vIssue, v.null()),
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) return null;
    const userId = ctx.auth.userId;

    const ids =
      issue.assigneeUserId === undefined
        ? [issue.createdByUserId]
        : [issue.createdByUserId, issue.assigneeUserId];
    const [project, userDocs] = await Promise.all([
      ctx.db.get(issue.projectId),
      auth.user.get(ctx, { ids }),
      auth.member.assert(ctx, {
        userId,
        groupId: issue.groupId,
        grants: ["projects.read"],
      }),
    ]);
    if (!project) return null;
    const userMap = new Map<Doc<"issues">["createdByUserId"], UserLookup>(
      ids.map((id, i) => [id, userDocs[i]]),
    );

    return toIssueView(project, issue, userMap);
  },
});

export const create = authMutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    priority: v.optional(issuePriority),
    labels: v.optional(v.array(v.string())),
  },
  returns: v.object({ issueId: v.id("issues") }),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) {
      throw new ConvexError({ code: ErrorCode.NOT_FOUND, message: "Project not found." });
    }
    const userId = ctx.auth.userId;

    await auth.member.assert(ctx, {
      userId,
      groupId: project.groupId,
      grants: ["issues.create"],
    });

    const nextNumber = project.issueCounter + 1;
    await ctx.db.patch(args.projectId, {
      issueCounter: nextNumber,
      openIssueCount: (project.openIssueCount ?? 0) + 1,
    });

    const issueId = await ctx.db.insert("issues", {
      projectId: project._id,
      groupId: project.groupId,
      scopeGroupId: project.groupId,
      number: nextNumber,
      title: args.title.trim(),
      status: "backlog",
      priority: args.priority ?? "none",
      createdByUserId: userId,
      labels: args.labels ?? [],
      position: nextNumber,
    });

    return { issueId };
  },
});

export const update = authMutation({
  args: {
    issueId: v.id("issues"),
    patch: v.object({
      title: v.optional(v.string()),
      status: v.optional(issueStatus),
      priority: v.optional(issuePriority),
      assigneeUserId: v.optional(v.union(vAuthUserId, v.null())),
      labels: v.optional(v.array(v.string())),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = ctx.auth.userId;
    const issue = await ctx.db.get(args.issueId);
    if (!issue) {
      throw new ConvexError({ code: ErrorCode.NOT_FOUND, message: "Issue not found." });
    }

    const needsEdit =
      args.patch.title !== undefined ||
      args.patch.priority !== undefined ||
      args.patch.labels !== undefined;
    const needsMove = args.patch.status !== undefined;
    const needsAssign = args.patch.assigneeUserId !== undefined;

    if (needsEdit) {
      await auth.member.assert(ctx, { userId, groupId: issue.groupId, grants: ["issues.edit"] });
      try {
        await auth.member.assert(ctx, {
          userId,
          groupId: issue.groupId,
          grants: ["issues.assign"],
        });
      } catch {
        const isOwnerOrAssignee =
          issue.createdByUserId === userId || issue.assigneeUserId === userId;
        if (!isOwnerOrAssignee) {
          throw new ConvexError({ code: ErrorCode.FORBIDDEN, message: "Access denied." });
        }
      }
    }
    if (needsMove) {
      await auth.member.assert(ctx, { userId, groupId: issue.groupId, grants: ["issues.move"] });
    }
    if (needsAssign) {
      const grant = args.patch.assigneeUserId !== userId ? "issues.assign" : "issues.move";
      await auth.member.assert(ctx, { userId, groupId: issue.groupId, grants: [grant] });
      const assigneeUserId = args.patch.assigneeUserId;
      if (assigneeUserId !== null && assigneeUserId !== undefined) {
        const assignee = await auth.member.get(ctx, {
          userId: assigneeUserId,
          groupId: issue.groupId,
        });
        if (!assignee.membership) {
          throw new ConvexError({
            code: ErrorCode.INVALID_INPUT,
            message: "Assignee must be a member of this group.",
          });
        }
      }
    }

    const patch: Partial<
      Pick<Doc<"issues">, "title" | "status" | "priority" | "assigneeUserId" | "labels">
    > = {};
    if (args.patch.title !== undefined) patch.title = args.patch.title.trim();
    if (args.patch.status !== undefined) patch.status = args.patch.status;
    if (args.patch.priority !== undefined) patch.priority = args.patch.priority;
    if (args.patch.assigneeUserId !== undefined) {
      patch.assigneeUserId =
        args.patch.assigneeUserId === null ? undefined : args.patch.assigneeUserId;
    }
    if (args.patch.labels !== undefined) patch.labels = args.patch.labels;

    if (args.patch.status !== undefined && args.patch.status !== issue.status) {
      const wasOpen = issue.status !== "done" && issue.status !== "cancelled";
      const isNowOpen = args.patch.status !== "done" && args.patch.status !== "cancelled";
      if (wasOpen !== isNowOpen) {
        const project = await ctx.db.get(issue.projectId);
        if (project) {
          await ctx.db.patch(issue.projectId, {
            openIssueCount: Math.max(0, (project.openIssueCount ?? 0) + (isNowOpen ? 1 : -1)),
          });
        }
      }
    }

    await ctx.db.patch(args.issueId, patch);
    return null;
  },
});

export const remove = authMutation({
  args: { issueId: v.id("issues") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) return null;
    const userId = ctx.auth.userId;

    await auth.member.assert(ctx, {
      userId,
      groupId: issue.groupId,
      grants: ["issues.delete"],
    });

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
      .take(ISSUE_DELETE_COMMENT_LIMIT + 1);
    if (comments.length > ISSUE_DELETE_COMMENT_LIMIT) {
      throw new ConvexError({
        code: ErrorCode.INVALID_INPUT,
        message: "Issue has too many comments to delete in one operation.",
      });
    }
    for (const comment of comments) await ctx.db.delete(comment._id);

    const isOpen = issue.status !== "done" && issue.status !== "cancelled";
    if (isOpen) {
      const project = await ctx.db.get(issue.projectId);
      if (project) {
        await ctx.db.patch(issue.projectId, {
          openIssueCount: Math.max(0, (project.openIssueCount ?? 0) - 1),
        });
      }
    }

    await ctx.db.delete(args.issueId);
    return null;
  },
});
