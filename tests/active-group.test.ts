import { components } from "@convex/_generated/api";
import { auth as backendAuth } from "@convex/auth";
import schema from "@convex/schema";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";

test("active group update validates membership and reset restores fallback", async () => {
  const t = convexTest(schema);
  const { userId, firstGroupId, secondGroupId, outsiderGroupId } = await t.run(async (ctx) => {
    const userId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "active@example.com" },
    });
    const firstGroupId = await ctx.runMutation(components.auth.group.create, {
      name: "First",
    });
    const secondGroupId = await ctx.runMutation(components.auth.group.create, {
      name: "Second",
    });
    const outsiderGroupId = await ctx.runMutation(components.auth.group.create, {
      name: "Outsider",
    });
    await ctx.runMutation(components.auth.group.member.create, {
      userId,
      groupId: firstGroupId,
      roleIds: ["member"],
    });
    await ctx.runMutation(components.auth.group.member.create, {
      userId,
      groupId: secondGroupId,
      roleIds: ["member"],
    });
    return { userId, firstGroupId, secondGroupId, outsiderGroupId };
  });

  const current = t.withIdentity({ subject: userId, sid: "active-session" as any });
  const fallback = await current.run((ctx) => backendAuth.group.active.get(ctx as any));
  expect(fallback?.groupId).toBe(firstGroupId);

  await current.run((ctx) =>
    backendAuth.group.active.update(ctx as any, { groupId: secondGroupId }),
  );
  const selected = await current.run((ctx) => backendAuth.group.active.get(ctx as any));
  expect(selected?.groupId).toBe(secondGroupId);
  expect(selected?.membership.groupId).toBe(secondGroupId);

  await expect(
    current.run((ctx) => backendAuth.group.active.update(ctx as any, { groupId: outsiderGroupId })),
  ).rejects.toThrow("not a member");

  await current.run((ctx) => backendAuth.group.active.reset(ctx as any));
  const reset = await current.run((ctx) => backendAuth.group.active.get(ctx as any));
  expect(reset?.groupId).toBe(firstGroupId);
});
