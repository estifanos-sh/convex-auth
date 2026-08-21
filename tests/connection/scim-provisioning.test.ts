/**
 * SCIM provisioning-cycle tests (audit finding H16 — SCIM was config/validate
 * only; no provisioning-cycle/reconciliation test).
 *
 * The SCIM HTTP handler (bearer auth + filter parsing + RFC-7644 serialization)
 * ultimately drives three component mutations: it creates a `GroupMember`,
 * flips its `status` on a PATCH `active:false`, and records a
 * `GroupConnectionScimIdentity` linking the external IdP id to the local user
 * (keyed `(connectionId, resourceType, externalId)`, upserted). These are the
 * durable state changes an SSO admin relies on, and they run in-memory here via
 * `convexTest` against the component — no Docker, no HTTP.
 *
 * NOT covered here (interop / HTTP-layer only — flagged in the H16 report):
 * SCIM bearer-token auth, the SCIM filter grammar (`userName eq ...`), and the
 * RFC-7644 request/response serialization, all of which live in the HTTP action
 * and need the Docker interop suite (or a `t.fetch` HTTP-router test). The
 * webhook-delivery *signature scheme* is also interop-only: the HMAC is
 * computed inline inside `createGroupService` (server/connection/group/
 * service.ts), not exposed as a pure function, and reconstructing it in a test
 * would only assert a copy of the scheme, not the real one.
 */

import { components } from "@convex/_generated/api";
import schema from "@convex/schema";
import { ErrorCode } from "@estifanos-sh/convex-auth/shared/codes";
import { notifyScimAfterProvision } from "@estifanos-sh/convex-auth/server/connection/http";
import { ConvexError } from "convex/values";
import { expect, test, vi } from "vite-plus/test";

import { convexTest } from "../convex/setup";

/**
 * `member.get` is overloaded (single lookup or batched array), so its return
 * type is a union; the single-id / single-pair calls here always resolve to one
 * doc, narrowed via this shape.
 */
type MemberDoc = { _id: string; status?: string; userId: string } | null;

const provisionScimUser = components.auth.connection.scim.identity.provision;
const provisionScimGroup = components.auth.connection.scim.identity.provisionGroup;
const updateScimGroup = components.auth.connection.scim.identity.updateGroup;
const revokeScimGroup = components.auth.connection.scim.identity.revokeGroup;

/** Seed a group + an active SCIM-capable connection, mirroring replay.test.ts. */
async function seedConnection(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const groupId = await ctx.runMutation(components.auth.group.create, {
      name: "SCIM Org",
      slug: "scim-org",
      type: "organization",
    });
    const connectionId = await ctx.runMutation(components.auth.connection.create, {
      groupId,
      slug: "scim-conn",
      name: "SCIM Connection",
      protocol: "oidc",
      status: "active",
    });
    await ctx.runMutation(components.auth.connection.scim.config.upsert, {
      connectionId,
      groupId,
      status: "active",
      basePath: `/scim/${connectionId}`,
      tokenHash: `test-token-${connectionId}`,
    });
    return { groupId, connectionId };
  });
}

test("SCIM create-user provisions a membership and a linked SCIM identity", async () => {
  const t = convexTest(schema);
  const { groupId, connectionId } = await seedConnection(t);

  const { userId } = await t.run((ctx) =>
    ctx.runMutation(provisionScimUser, {
      connectionId,
      externalId: "okta-user-001",
      userData: { email: "provisioned@example.com", name: "Provisioned User" },
      profileUpdate: "always",
      roleIds: [],
      active: true,
    }),
  );

  // Membership now exists and is discoverable by (groupId, userId).
  const membership = (await t.run((ctx) =>
    ctx.runQuery(components.auth.group.member.get, { groupId, userId }),
  )) as MemberDoc;
  expect(membership?.status).toBe("active");
  const identity = await t.run((ctx) =>
    ctx.runQuery(components.auth.connection.scim.identity.get, {
      connectionId,
      resourceType: "user",
      externalId: "okta-user-001",
    }),
  );
  expect((identity as { userId?: string } | null)?.userId).toBe(userId);
});

test("SCIM provisions connection-owned users and groups without an externalId", async () => {
  const t = convexTest(schema);
  const { groupId, connectionId } = await seedConnection(t);

  const user = await t.run((ctx) =>
    ctx.runMutation(provisionScimUser, {
      connectionId,
      userData: { email: "directory-user@example.com", name: "Directory User" },
      profileUpdate: "always",
      roleIds: [],
      active: true,
    }),
  );
  const group = await t.run((ctx) =>
    ctx.runMutation(provisionScimGroup, {
      connectionId,
      name: "Directory Group",
      memberIds: [user.userId],
      roleIds: [],
    }),
  );

  const state = await t.run(async (ctx) => ({
    userIdentity: await ctx.runQuery(components.auth.connection.scim.identity.get, {
      connectionId,
      userId: user.userId,
    }),
    groupIdentity: await ctx.runQuery(components.auth.connection.scim.identity.get, {
      mappedGroupId: group.groupId,
    }),
    accounts: await ctx.runQuery(components.auth.account.list, { userId: user.userId }),
    membership: await ctx.runQuery(components.auth.group.member.get, {
      groupId,
      userId: user.userId,
    }),
  }));

  expect(state.userIdentity).toMatchObject({
    connectionId,
    userId: user.userId,
    resourceType: "user",
  });
  expect(state.groupIdentity).toMatchObject({
    connectionId,
    mappedGroupId: group.groupId,
    resourceType: "group",
  });
  expect(state.accounts).toHaveLength(0);
  expect(state.membership).toMatchObject({ status: "active" });
});

test("SCIM PATCH active:false deactivates the membership (status flip)", async () => {
  const t = convexTest(schema);
  const { groupId } = await seedConnection(t);

  const { userId, memberId } = await t.run(async (ctx) => {
    const userId = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "deactivate@example.com" },
    })) as never;
    const memberId = await ctx.runMutation(components.auth.group.member.create, {
      groupId,
      userId,
      status: "active",
    });
    return { userId, memberId };
  });

  // PATCH /Users/{id} with { active: false } maps to a status patch.
  await t.run((ctx) =>
    ctx.runMutation(components.auth.group.member.update, {
      id: memberId,
      patch: { status: "inactive" },
    }),
  );

  const updated = (await t.run((ctx) =>
    ctx.runQuery(components.auth.group.member.get, { id: memberId }),
  )) as MemberDoc;
  expect(updated?.status).toBe("inactive");

  // A status-filtered list is how "filter active members" is served; the now
  // inactive member must not appear in the active set.
  const activeMembers = await t.run((ctx) =>
    ctx.runQuery(components.auth.group.member.list, {
      where: { groupId, status: "active" },
      paginationOpts: { cursor: null, numItems: 50 },
    }),
  );
  expect(activeMembers.page.some((m: { userId: string }) => m.userId === userId)).toBe(false);
});

test("SCIM user aggregates require an active SCIM configuration", async () => {
  const t = convexTest(schema);
  const { groupId, connectionId } = await seedConnection(t);
  await t.run((ctx) =>
    ctx.runMutation(components.auth.connection.scim.config.upsert, {
      connectionId,
      groupId,
      status: "disabled",
      basePath: `/scim/${connectionId}`,
      tokenHash: `disabled-${connectionId}`,
    }),
  );
  await expect(
    t.run((ctx) =>
      ctx.runMutation(provisionScimUser, {
        connectionId,
        externalId: "blocked-by-disabled-scim",
        userData: { email: "blocked@example.com" },
        profileUpdate: "always",
        roleIds: [],
        active: true,
      }),
    ),
  ).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof ConvexError &&
      (error.data as { code?: string }).code === ErrorCode.INVALID_PARAMETERS,
  );
  const users = await t.run((ctx) =>
    ctx.runQuery(components.auth.user.list, {
      paginationOpts: { cursor: null, numItems: 10 },
    }),
  );
  expect(users.page).toHaveLength(0);
});

test("SCIM user provisioning atomically deduplicates User, Account, and identity", async () => {
  const t = convexTest(schema);
  const { groupId, connectionId } = await seedConnection(t);
  const args = {
    connectionId,
    externalId: "atomic-external-user",
    profileUpdate: "missing" as const,
    roleIds: ["member"],
    userData: {
      email: "atomic@example.com",
      emailVerificationTime: Date.now(),
      name: "Atomic SCIM User",
      firstName: "Atomic",
      lastName: "User",
    },
    active: true,
    raw: { userName: "atomic@example.com" },
    lastProvisionedAt: Date.now(),
  };

  const first = (await t.run((ctx) => ctx.runMutation(provisionScimUser, args))) as {
    userId: string;
    created: boolean;
  };
  const retry = (await t.run((ctx) =>
    ctx.runMutation(provisionScimUser, {
      ...args,
      userData: { ...args.userData, name: "Retry profile" },
      lastProvisionedAt: args.lastProvisionedAt + 1,
    }),
  )) as { userId: string; created: boolean };

  expect(first.created).toBe(true);
  expect(retry).toEqual({ userId: first.userId, created: false });

  const { account, identity, accounts, membership, users } = await t.run(async (ctx) => ({
    account: await ctx.runQuery(components.auth.account.get, {
      provider: `oidc:${connectionId}`,
      providerAccountId: args.externalId,
    }),
    identity: await ctx.runQuery(components.auth.connection.scim.identity.get, {
      connectionId,
      resourceType: "user",
      externalId: args.externalId,
    }),
    accounts: await ctx.runQuery(components.auth.account.list, {
      userId: first.userId as never,
    }),
    membership: await ctx.runQuery(components.auth.group.member.get, {
      groupId,
      userId: first.userId as never,
    }),
    users: await ctx.runQuery(components.auth.user.list, {
      paginationOpts: { cursor: null, numItems: 10 },
    }),
  }));

  expect(account?.userId).toBe(first.userId);
  const resolvedIdentity = identity as { userId?: string; lastProvisionedAt?: number } | null;
  expect(resolvedIdentity?.userId).toBe(first.userId);
  expect(resolvedIdentity?.lastProvisionedAt).toBe(args.lastProvisionedAt + 1);
  expect(accounts).toHaveLength(1);
  expect(membership).toMatchObject({ roleIds: ["member"], status: "active" });
  expect(users.page).toHaveLength(1);
  expect(users.page[0]).toMatchObject({
    name: "Atomic SCIM User",
    firstName: "Atomic",
    lastName: "User",
  });
});

test("a failed SCIM post-provision notification preserves committed state", async () => {
  const t = convexTest(schema);
  const { connectionId } = await seedConnection(t);
  const provisioned = await t.run((ctx) =>
    ctx.runMutation(provisionScimUser, {
      connectionId,
      externalId: "hook-failure-user",
      userData: { email: "hook-failure@example.com" },
      profileUpdate: "always",
      roleIds: [],
      active: true,
    }),
  );
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await expect(
    notifyScimAfterProvision(async () => {
      throw new Error("notification destination unavailable");
    }),
  ).resolves.toBeUndefined();
  error.mockRestore();

  const identity = await t.run((ctx) =>
    ctx.runQuery(components.auth.connection.scim.identity.get, {
      connectionId,
      resourceType: "user",
      externalId: "hook-failure-user",
    }),
  );
  expect((identity as { userId?: string } | null)?.userId).toBe(provisioned.userId);
});

test("SCIM update rejects a user owned by another connection", async () => {
  const t = convexTest(schema);
  const { connectionId } = await seedConnection(t);
  const { connectionId: otherConnectionId } = await seedConnection(t);
  const provisioned = await t.run((ctx) =>
    ctx.runMutation(provisionScimUser, {
      connectionId,
      externalId: "directory-user",
      userData: { email: "directory@example.com" },
      profileUpdate: "always",
      roleIds: [],
      active: true,
    }),
  );

  await expect(
    t.run((ctx) =>
      ctx.runMutation(components.auth.connection.scim.identity.update, {
        connectionId: otherConnectionId,
        userId: provisioned.userId,
        externalId: "directory-user",
        userData: { name: "Must not update" },
        profileUpdate: "always",
        roleIds: [],
        active: true,
      }),
    ),
  ).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof ConvexError &&
      (error.data as { code?: string }).code === ErrorCode.ACCOUNT_NOT_FOUND,
  );
});

test("SCIM update rotates and revocation removes the connection Account", async () => {
  const t = convexTest(schema);
  const { groupId, connectionId } = await seedConnection(t);
  const externalId = "directory-user-before-rename";
  const replacementExternalId = "directory-user-after-rename";
  const provisioned = await t.run((ctx) =>
    ctx.runMutation(provisionScimUser, {
      connectionId,
      externalId,
      userData: { email: "rotate@example.com" },
      profileUpdate: "always",
      roleIds: ["member"],
      active: true,
    }),
  );

  await t.run((ctx) =>
    ctx.runMutation(components.auth.connection.scim.identity.update, {
      connectionId,
      userId: provisioned.userId,
      externalId: replacementExternalId,
      userData: { name: "Renamed directory user" },
      profileUpdate: "always",
      roleIds: ["admin"],
      active: true,
    }),
  );

  const afterUpdate = await t.run(async (ctx) => ({
    oldAccount: await ctx.runQuery(components.auth.account.get, {
      provider: `oidc:${connectionId}`,
      providerAccountId: externalId,
    }),
    replacementAccount: await ctx.runQuery(components.auth.account.get, {
      provider: `oidc:${connectionId}`,
      providerAccountId: replacementExternalId,
    }),
    membership: await ctx.runQuery(components.auth.group.member.get, {
      groupId,
      userId: provisioned.userId,
    }),
  }));
  expect(afterUpdate.oldAccount).toBeNull();
  expect(afterUpdate.replacementAccount?.userId).toBe(provisioned.userId);
  expect(afterUpdate.membership).toMatchObject({ roleIds: ["admin"], status: "active" });

  await t.run((ctx) =>
    ctx.runMutation(components.auth.connection.scim.identity.revoke, {
      connectionId,
      userId: provisioned.userId,
      mode: "hard",
    }),
  );

  const afterRevoke = await t.run(async (ctx) => ({
    account: await ctx.runQuery(components.auth.account.get, {
      provider: `oidc:${connectionId}`,
      providerAccountId: replacementExternalId,
    }),
    identity: await ctx.runQuery(components.auth.connection.scim.identity.get, {
      connectionId,
      userId: provisioned.userId,
    }),
    membership: await ctx.runQuery(components.auth.group.member.get, {
      groupId,
      userId: provisioned.userId,
    }),
  }));
  expect(afterRevoke.account).toBeNull();
  expect(afterRevoke.identity).toBeNull();
  expect(afterRevoke.membership).toBeNull();
});

test("SCIM group lifecycle is atomic across identity, group, and memberships", async () => {
  const t = convexTest(schema);
  const { groupId, connectionId } = await seedConnection(t);
  const { connectionId: outsideConnectionId } = await seedConnection(t);
  const provisionUser = (targetConnectionId: string, externalId: string) =>
    t.run((ctx) =>
      ctx.runMutation(provisionScimUser, {
        connectionId: targetConnectionId as never,
        externalId,
        userData: { email: `${externalId}@example.com` },
        profileUpdate: "always",
        roleIds: [],
        active: true,
      }),
    );
  const first = await provisionUser(connectionId, "group-member-first");
  const second = await provisionUser(connectionId, "group-member-second");
  const outside = await provisionUser(outsideConnectionId, "outside-directory-member");

  await expect(
    t.run((ctx) =>
      ctx.runMutation(provisionScimGroup, {
        connectionId,
        externalId: "engineering",
        name: "Engineering",
        memberIds: [first.userId, outside.userId],
        roleIds: ["member"],
      }),
    ),
  ).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof ConvexError &&
      (error.data as { code?: string }).code === ErrorCode.ACCOUNT_NOT_FOUND,
  );

  const afterRejectedProvision = await t.run(async (ctx) => ({
    identity: await ctx.runQuery(components.auth.connection.scim.identity.get, {
      connectionId,
      resourceType: "group",
      externalId: "engineering",
    }),
    groups: await ctx.runQuery(components.auth.group.list, {
      where: { parentGroupId: groupId },
      paginationOpts: { cursor: null, numItems: 10 },
    }),
  }));
  expect(afterRejectedProvision.identity).toBeNull();
  expect(afterRejectedProvision.groups.page).toHaveLength(0);

  const provisioned = await t.run((ctx) =>
    ctx.runMutation(provisionScimGroup, {
      connectionId,
      externalId: "engineering",
      name: "Engineering",
      memberIds: [first.userId, second.userId],
      roleIds: ["member"],
    }),
  );
  await t.run((ctx) =>
    ctx.runMutation(updateScimGroup, {
      connectionId,
      groupId: provisioned.groupId,
      memberIds: [second.userId],
      roleIds: ["owner"],
    }),
  );
  const afterReplace = await t.run((ctx) =>
    ctx.runQuery(components.auth.group.member.list, {
      where: { groupId: provisioned.groupId },
      paginationOpts: { cursor: null, numItems: 10 },
    }),
  );
  expect(afterReplace.page).toMatchObject([
    { userId: second.userId, roleIds: ["owner"], status: "active" },
  ]);

  await t.run((ctx) =>
    ctx.runMutation(revokeScimGroup, { connectionId, groupId: provisioned.groupId }),
  );
  const afterRevoke = await t.run(async (ctx) => ({
    group: await ctx.runQuery(components.auth.group.get, { id: provisioned.groupId }),
    identity: await ctx.runQuery(components.auth.connection.scim.identity.get, {
      connectionId,
      resourceType: "group",
      externalId: "engineering",
    }),
    members: await ctx.runQuery(components.auth.group.member.list, {
      where: { groupId: provisioned.groupId },
      paginationOpts: { cursor: null, numItems: 10 },
    }),
  }));
  expect(afterRevoke.group).toBeNull();
  expect(afterRevoke.identity).toBeNull();
  expect(afterRevoke.members.page).toHaveLength(0);
});

test("member.create rejects a duplicate membership for the same user", async () => {
  const t = convexTest(schema);
  const { groupId } = await seedConnection(t);

  const userId = (await t.run((ctx) =>
    ctx.runMutation(components.auth.user.create, { data: { email: "dupe@example.com" } }),
  )) as never;

  await t.run((ctx) =>
    ctx.runMutation(components.auth.group.member.create, { groupId, userId, status: "active" }),
  );

  await expect(
    t.run((ctx) =>
      ctx.runMutation(components.auth.group.member.create, { groupId, userId, status: "active" }),
    ),
  ).rejects.toThrow(/DUPLICATE_MEMBERSHIP|already a member/);
});
