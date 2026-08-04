import { components } from "@convex/_generated/api";
import schema from "@convex/schema";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";

test("user removal always deletes auth-owned credential and profile rows", async () => {
  const t = convexTest(schema);
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "remove-everything@example.com" },
    });
    await ctx.runMutation(components.auth.account.create, {
      userId,
      provider: "password",
      providerAccountId: "remove-everything@example.com",
      secret: "hashed-password",
    });
    await ctx.runMutation(components.auth.factor.passkey.create, {
      userId,
      credentialId: "remove-everything-credential",
      publicKey: new ArrayBuffer(32),
      algorithm: -7,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      createdAt: Date.now(),
    });
    await ctx.runMutation(components.auth.factor.totp.create, {
      userId,
      secret: new ArrayBuffer(20),
      digits: 6,
      period: 30,
      verified: true,
      createdAt: Date.now(),
    });
    await ctx.runMutation(components.auth.user.email.upsert, {
      userId,
      email: "remove-everything@example.com",
      verified: true,
      source: "password",
    });
    return userId;
  });

  await t.run((ctx) => ctx.runMutation(components.auth.user.remove, { id: userId }));

  const remaining = await t.run(async (ctx) => {
    const [user, accounts, passkeys, totps, emails] = await Promise.all([
      ctx.runQuery(components.auth.user.get, { id: userId }),
      ctx.runQuery(components.auth.account.list, { userId }),
      ctx.runQuery(components.auth.factor.passkey.list, { userId }),
      ctx.runQuery(components.auth.factor.totp.list, { userId }),
      ctx.runQuery(components.auth.user.email.list, { userId }),
    ]);
    return { user, accounts, passkeys, totps, emails };
  });

  expect(remaining).toEqual({
    user: null,
    accounts: [],
    passkeys: [],
    totps: [],
    emails: [],
  });
});
