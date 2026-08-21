import { components } from "@convex/_generated/api";
import schema from "@convex/schema";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";

/**
 * Regression coverage for the invite retention / prune-starvation fix
 * (component/maintenance.ts + component/group/invite.ts).
 *
 * These run against the component SOURCE (the test project aliases
 * `@estifanos-sh/convex-auth` to `packages/auth/src`), so they exercise the patched
 * behavior directly.
 */

test("revoke clears expiresTime so the invite leaves the expiry retention index", async () => {
  const t = convexTest(schema);
  const now = Date.now();

  const inviteId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.group.invite.create, {
      tokenHash: `revoke-clears-${now}`,
      expiresTime: now + 60_000,
    });
  });

  await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.group.invite.revoke, { id: inviteId });
  });

  const invite = (await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.group.invite.get, { id: inviteId });
  })) as { status: string; expiresTime?: number } | null;

  expect(invite?.status).toBe("revoked");
  // Cleared on the terminal transition so it can no longer pin the front of the
  // `expires_time` index (it is reclaimed by age instead).
  expect(invite?.expiresTime).toBeUndefined();
});
