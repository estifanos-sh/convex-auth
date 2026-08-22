import { components } from "@convex/_generated/api";
import schema from "@convex/schema";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";

test("component batch selectors accept 100 IDs and reject 101", async () => {
  const t = convexTest(schema);
  const { connectionId, groupId, userId } = await t.run(async (ctx) => {
    const userId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "batch@example.com" },
    });
    const groupId = await ctx.runMutation(components.auth.group.create, {
      name: "Batch Group",
      slug: "batch-group",
      type: "organization",
    });
    await ctx.runMutation(components.auth.group.member.create, { groupId, userId });
    const connectionId = await ctx.runMutation(components.auth.connection.create, {
      groupId,
      slug: "batch-connection",
      name: "Batch Connection",
      protocol: "oidc",
      status: "active",
    });
    return { connectionId, groupId, userId };
  });

  const hundredUserIds = Array.from({ length: 100 }, () => userId);
  const hundredGroupIds = Array.from({ length: 100 }, () => groupId);
  const [users, groups, memberships, identities] = await t.run(async (ctx) =>
    Promise.all([
      ctx.runQuery(components.auth.user.get, { ids: hundredUserIds }),
      ctx.runQuery(components.auth.group.get, { ids: hundredGroupIds }),
      ctx.runQuery(components.auth.group.member.get, { userId, groupIds: hundredGroupIds }),
      ctx.runQuery(components.auth.connection.scim.identity.get, {
        connectionId,
        userIds: hundredUserIds,
      }),
    ]),
  );
  expect(users).toHaveLength(100);
  expect(groups).toHaveLength(100);
  expect(memberships).toHaveLength(100);
  expect(identities).toHaveLength(100);

  const tooManyUserIds = Array.from({ length: 101 }, () => userId);
  const tooManyGroupIds = Array.from({ length: 101 }, () => groupId);
  await expect(
    t.run((ctx) => ctx.runQuery(components.auth.user.get, { ids: tooManyUserIds })),
  ).rejects.toThrow("INVALID_PARAMETERS");
  await expect(
    t.run((ctx) => ctx.runQuery(components.auth.group.get, { ids: tooManyGroupIds })),
  ).rejects.toThrow("INVALID_PARAMETERS");
  await expect(
    t.run((ctx) =>
      ctx.runQuery(components.auth.group.member.get, { userId, groupIds: tooManyGroupIds }),
    ),
  ).rejects.toThrow("INVALID_PARAMETERS");
  await expect(
    t.run((ctx) =>
      ctx.runQuery(components.auth.connection.scim.identity.get, {
        connectionId,
        userIds: tooManyUserIds,
      }),
    ),
  ).rejects.toThrow("INVALID_PARAMETERS");
});
