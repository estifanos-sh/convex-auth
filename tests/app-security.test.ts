import { api, components } from "@convex/_generated/api";
import schema from "@convex/schema";
import { createAuthTest } from "@estifanos-sh/convex-auth/test";
import type { FunctionArgs } from "convex/server";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";

type GroupId = FunctionArgs<typeof api.groups.updateMemberRole>["groupId"];
type MemberId = FunctionArgs<typeof api.groups.updateMemberRole>["memberId"];
type InviteId = FunctionArgs<typeof api.groups.revokeInvite>["inviteId"];

test("group managers cannot update a member or revoke an invite from another group", async () => {
  const t = convexTest(schema);
  const auth = createAuthTest(t, components.auth);
  const adminUserId = await auth.user.create({ data: { email: "admin@example.com" } });
  const targetUserId = await auth.user.create({ data: { email: "target@example.com" } });
  const adminSession = await auth.session.create({ userId: adminUserId });

  const setup = await t.run(async (ctx) => {
    const managedGroupId = await ctx.runMutation(components.auth.group.create, {
      name: "Managed group",
    });
    const otherGroupId = await ctx.runMutation(components.auth.group.create, {
      name: "Other group",
    });
    await ctx.runMutation(components.auth.group.member.create, {
      groupId: managedGroupId,
      userId: adminUserId,
      roleIds: ["orgAdmin"],
    });
    const otherMemberId = await ctx.runMutation(components.auth.group.member.create, {
      groupId: otherGroupId,
      userId: targetUserId,
      roleIds: ["member"],
    });
    const otherInviteId = await ctx.runMutation(components.auth.group.invite.create, {
      groupId: otherGroupId,
      tokenHash: "other-group-invite",
    });
    return { managedGroupId, otherMemberId, otherInviteId };
  });
  const { managedGroupId, otherMemberId, otherInviteId } = setup as unknown as {
    managedGroupId: GroupId;
    otherMemberId: MemberId;
    otherInviteId: InviteId;
  };

  const asAdmin = t.withIdentity(adminSession.identity);
  await expect(
    asAdmin.mutation(api.groups.updateMemberRole, {
      groupId: managedGroupId,
      memberId: otherMemberId,
      roleId: "viewer",
    }),
  ).rejects.toThrow("Member not found");
  await expect(
    asAdmin.mutation(api.groups.revokeInvite, {
      groupId: managedGroupId,
      inviteId: otherInviteId,
    }),
  ).rejects.toThrow("Invite not found");

  const [member, invite] = await t.run((ctx) =>
    Promise.all([
      ctx.runQuery(components.auth.group.member.get, { id: otherMemberId }),
      ctx.runQuery(components.auth.group.invite.get, { id: otherInviteId }),
    ]),
  );
  expect((member as { roleIds?: string[] } | null)?.roleIds).toEqual(["member"]);
  expect(invite?.status).toBe("pending");
});

test("issue assignees must belong to the issue group and issue lists paginate", async () => {
  const t = convexTest(schema);
  const auth = createAuthTest(t, components.auth);
  const adminUserId = await auth.user.create({ data: { email: "issue-admin@example.com" } });
  const outsiderUserId = await auth.user.create({ data: { email: "outsider@example.com" } });
  const adminSession = await auth.session.create({ userId: adminUserId });

  const groupId = (await t.run(async (ctx) => {
    const groupId = await ctx.runMutation(components.auth.group.create, { name: "Issue group" });
    const otherGroupId = await ctx.runMutation(components.auth.group.create, {
      name: "Outsider group",
    });
    await ctx.runMutation(components.auth.group.member.create, {
      groupId,
      userId: adminUserId,
      roleIds: ["orgAdmin"],
    });
    await ctx.runMutation(components.auth.group.member.create, {
      groupId: otherGroupId,
      userId: outsiderUserId,
      roleIds: ["member"],
    });
    return groupId;
  })) as unknown as GroupId;

  const asAdmin = t.withIdentity(adminSession.identity);
  const { projectId } = await asAdmin.mutation(api.projects.create, {
    groupId,
    name: "Security project",
  });
  const first = await asAdmin.mutation(api.issues.create, {
    projectId,
    title: "First issue",
  });
  await asAdmin.mutation(api.issues.create, { projectId, title: "Second issue" });

  await expect(
    asAdmin.mutation(api.issues.update, {
      issueId: first.issueId,
      patch: { assigneeUserId: outsiderUserId },
    }),
  ).rejects.toThrow("Assignee must be a member of this group");

  const firstPage = await asAdmin.query(api.issues.list, {
    projectId,
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(firstPage.issues).toHaveLength(1);
  expect(firstPage.isDone).toBe(false);

  const secondPage = await asAdmin.query(api.issues.list, {
    projectId,
    paginationOpts: { numItems: 1, cursor: firstPage.continueCursor },
  });
  expect(secondPage.issues).toHaveLength(1);
  expect(secondPage.isDone).toBe(true);
});

test("email existence checks are authenticated and scoped to the caller's email", async () => {
  const t = convexTest(schema);
  const auth = createAuthTest(t, components.auth);
  const firstUserId = await auth.user.create({ data: { email: "first@example.com" } });
  const secondUserId = await auth.user.create({ data: { email: "second@example.com" } });
  const firstSession = await auth.session.create({ userId: firstUserId });
  const secondSession = await auth.session.create({ userId: secondUserId });

  await expect(t.query(api.groups.emailExists, { email: "first@example.com" })).rejects.toThrow();
  await expect(
    t.withIdentity(secondSession.identity).query(api.groups.emailExists, {
      email: "first@example.com",
    }),
  ).resolves.toBe(false);
  await expect(
    t.withIdentity(firstSession.identity).query(api.groups.emailExists, {
      email: " FIRST@example.com ",
    }),
  ).resolves.toBe(true);
});

test("issue removal does not attempt an unbounded comment cascade", async () => {
  const t = convexTest(schema);
  const auth = createAuthTest(t, components.auth);
  const adminUserId = await auth.user.create({ data: { email: "delete-admin@example.com" } });
  const adminSession = await auth.session.create({ userId: adminUserId });
  const groupId = (await t.run(async (ctx) => {
    const groupId = await ctx.runMutation(components.auth.group.create, { name: "Delete group" });
    await ctx.runMutation(components.auth.group.member.create, {
      groupId,
      userId: adminUserId,
      roleIds: ["orgAdmin"],
    });
    return groupId;
  })) as unknown as GroupId;
  const asAdmin = t.withIdentity(adminSession.identity);
  const { projectId } = await asAdmin.mutation(api.projects.create, {
    groupId,
    name: "Delete project",
  });
  const { issueId } = await asAdmin.mutation(api.issues.create, {
    projectId,
    title: "Issue with many comments",
  });

  await t.run(async (ctx) => {
    for (let index = 0; index < 101; index += 1) {
      await ctx.db.insert("comments", {
        issueId,
        groupId,
        authorUserId: adminUserId,
        body: `Comment ${index}`,
      });
    }
  });

  await expect(asAdmin.mutation(api.issues.remove, { issueId })).rejects.toThrow(
    "Issue has too many comments to delete in one operation",
  );
  await expect(asAdmin.query(api.issues.get, { issueId })).resolves.not.toBeNull();
});
