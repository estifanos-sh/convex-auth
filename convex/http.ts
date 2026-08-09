import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { v } from "convex/values";

import { api, components, internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { auth } from "./auth";

const status = v.union(
  v.literal("backlog"),
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("done"),
  v.literal("cancelled"),
);
const priority = v.union(
  v.literal("none"),
  v.literal("urgent"),
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
);
const http = auth.http();

auth.request.mcp(
  http,
  {
    list_groups: {
      description: "List the workspaces (groups) the signed-in user belongs to.",
      scope: "projects.read",
      args: v.object({}),
      handler: (ctx) => ctx.runQuery(api.groups.list, {}),
    },
    get_workspace: {
      description: "Get a workspace's members, projects, permissions, and the user's role.",
      scope: "members.read",
      args: v.object({ groupId: v.string() }),
      handler: (ctx, a) => ctx.runQuery(api.groups.get, { groupId: a.groupId }),
    },
    list_projects: {
      description: "List the projects in a workspace.",
      scope: "projects.read",
      args: v.object({ groupId: v.string() }),
      handler: (ctx, a) => ctx.runQuery(api.projects.list, { groupId: a.groupId }),
    },
    list_issues: {
      description: "List the issues in a project.",
      scope: "projects.read",
      args: v.object({ projectId: v.id("projects") }),
      handler: (ctx, a) => ctx.runQuery(api.issues.list, { projectId: a.projectId }),
    },
    get_issue: {
      description: "Get a single issue by id.",
      scope: "projects.read",
      args: v.object({ issueId: v.id("issues") }),
      handler: (ctx, a) => ctx.runQuery(api.issues.get, { issueId: a.issueId }),
    },
    list_invites: {
      description: "List the pending member invites for a workspace.",
      scope: "members.manage",
      args: v.object({ groupId: v.string() }),
      handler: (ctx, a) => ctx.runQuery(api.groups.listInvites, { groupId: a.groupId }),
    },
    create_project: {
      description: "Create a project in a workspace. The identifier is derived from the name.",
      scope: "projects.create",
      args: v.object({ groupId: v.string(), name: v.string() }),
      handler: (ctx, a) =>
        ctx.runMutation(api.projects.create, { groupId: a.groupId, name: a.name }),
    },
    create_issue: {
      description: "Create an issue in a project.",
      scope: "issues.create",
      args: v.object({ projectId: v.id("projects"), title: v.string() }),
      handler: (ctx, a) =>
        ctx.runMutation(api.issues.create, { projectId: a.projectId, title: a.title }),
    },
    update_issue: {
      description: "Update an issue's title, status, priority, or assignee.",
      scope: "issues.edit",
      args: v.object({
        issueId: v.id("issues"),
        title: v.optional(v.string()),
        status: v.optional(status),
        priority: v.optional(priority),
        assigneeUserId: v.optional(v.string()),
      }),
      handler: (ctx, a) =>
        ctx.runMutation(api.issues.update, {
          issueId: a.issueId,
          patch: {
            title: a.title,
            status: a.status,
            priority: a.priority,
            assigneeUserId: a.assigneeUserId,
          },
        }),
    },
    remove_issue: {
      description: "Remove an issue by id.",
      scope: "issues.delete",
      args: v.object({ issueId: v.id("issues") }),
      handler: (ctx, a) => ctx.runMutation(api.issues.remove, { issueId: a.issueId }),
    },
    create_comment: {
      description: "Create a comment on an issue.",
      scope: "comments.create",
      args: v.object({ issueId: v.id("issues"), body: v.string() }),
      handler: (ctx, a) =>
        ctx.runMutation(api.comments.create, { issueId: a.issueId, body: a.body }),
    },
    remove_comment: {
      description: "Remove a comment by id.",
      scope: "comments.delete",
      args: v.object({ commentId: v.id("comments") }),
      handler: (ctx, a) => ctx.runMutation(api.comments.remove, { commentId: a.commentId }),
    },
    invite_member: {
      description:
        "Invite a member to a workspace by email with a role (orgAdmin, member, viewer).",
      scope: "members.manage",
      args: v.object({ groupId: v.string(), email: v.string(), roleId: v.string() }),
      handler: (ctx, a) =>
        ctx.runAction(api.groups.inviteMember, {
          groupId: a.groupId,
          email: a.email,
          roleId: a.roleId,
        }),
    },
    update_member_role: {
      description: "Change a member's role (orgAdmin, member, viewer) in a workspace.",
      scope: "members.manage",
      args: v.object({ groupId: v.string(), memberId: v.string(), roleId: v.string() }),
      handler: (ctx, a) =>
        ctx.runMutation(api.groups.updateMemberRole, {
          groupId: a.groupId,
          memberId: a.memberId,
          roleId: a.roleId,
        }),
    },
  },
  { name: "convex-auth-workspace" },
);

async function loadProject(ctx: ActionCtx, projectId: string) {
  const project = await ctx.runQuery(internal.issues.http.getProject, {
    projectId,
  });
  if (!project) {
    return new Response(JSON.stringify({ error: "Project not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return project;
}

async function parseIssueCreateBody(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request body." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "Expected a JSON object request body." }, { status: 400 });
  }
  return body as { projectId?: unknown; title?: unknown };
}

http.route({
  path: "/api/me",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const authContext = await auth.request.context(ctx, request);
    return Response.json({
      userId: authContext.userId,
      groupId: authContext.groupId,
      role: authContext.role,
      grants: authContext.grants,
      source: authContext.source,
      keyId: authContext.key?.keyId ?? null,
    });
  }),
});

http.route({
  path: "/api/issues",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const authContext = await auth.request.context(ctx, request);
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) {
      return Response.json(
        { error: "Missing required query parameter `projectId`." },
        { status: 400 },
      );
    }
    const project = await loadProject(ctx, projectId);
    if (project instanceof Response) {
      return project;
    }
    await auth.member.assert(ctx, {
      userId: authContext.userId,
      groupId: project.groupId,
      grants: ["projects.read"],
    });
    if (authContext.source === "key" && !authContext.key.scopes.can("issues", "read")) {
      return Response.json(
        { error: "This API key does not have issues.read access." },
        { status: 403 },
      );
    }
    const issues = await ctx.runQuery(internal.issues.http.list, {
      projectId,
    });
    return Response.json({
      project: {
        projectId: project.projectId,
        name: project.name,
        identifier: project.identifier,
      },
      issues: issues.map((issue) => ({
        issueId: issue.issueId,
        identifier: `${project.identifier}-${issue.number}`,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        labels: issue.labels ?? [],
      })),
    });
  }),
});

http.route({
  path: "/api/issues",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authContext = await auth.request.context(ctx, request);
    const body = await parseIssueCreateBody(request);
    if (body instanceof Response) {
      return body;
    }
    if (
      typeof body.projectId !== "string" ||
      typeof body.title !== "string" ||
      !body.title.trim()
    ) {
      return Response.json(
        { error: "Expected `projectId` and `title` in the request body." },
        { status: 400 },
      );
    }
    const project = await loadProject(ctx, body.projectId);
    if (project instanceof Response) {
      return project;
    }
    await auth.member.assert(ctx, {
      userId: authContext.userId,
      groupId: project.groupId,
      grants: ["issues.create"],
    });
    if (authContext.source === "key" && !authContext.key.scopes.can("issues", "write")) {
      return Response.json(
        { error: "This API key does not have issues.write access." },
        { status: 403 },
      );
    }
    const created = await ctx.runMutation(internal.issues.http.create, {
      projectId: body.projectId,
      userId: authContext.userId,
      title: body.title.trim(),
    });
    return Response.json({
      issueId: created.issueId,
      identifier: `${project.identifier}-${created.number}`,
    });
  }),
});

registerStaticRoutes(http, components.staticHosting, {
  pathPrefix: "/demo",
  spaFallback: true,
});

export default http;
