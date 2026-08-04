import { components } from "@convex/_generated/api";
import { auth as backendAuth } from "@convex/auth";
import schema from "@convex/schema";
import { ErrorCode } from "@robelest/convex-auth/shared/codes";
import { ConvexError } from "convex/values";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";

async function makeUser(t: ReturnType<typeof convexTest>, email: string): Promise<string> {
  return await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.user.create, { data: { email } });
  });
}

test("provider account creation is idempotent for the same user", async () => {
  const t = convexTest(schema);
  const userId = await makeUser(t, "link-idempotent@example.com");

  const first = await t.run((ctx) =>
    ctx.runMutation(components.auth.account.create, {
      userId,
      provider: "google",
      providerAccountId: "google-sub-idem",
    }),
  );
  const second = await t.run((ctx) =>
    ctx.runMutation(components.auth.account.create, {
      userId,
      provider: "google",
      providerAccountId: "google-sub-idem",
    }),
  );

  expect(second).toBe(first);
});

test("provider account creation refuses an identity owned by another user", async () => {
  const t = convexTest(schema);
  const userA = await makeUser(t, "owner@example.com");
  const userB = await makeUser(t, "intruder@example.com");

  await t.run((ctx) =>
    ctx.runMutation(components.auth.account.create, {
      userId: userA,
      provider: "github",
      providerAccountId: "github-shared-id",
    }),
  );

  await expect(
    t.run((ctx) =>
      ctx.runMutation(components.auth.account.create, {
        userId: userB,
        provider: "github",
        providerAccountId: "github-shared-id",
      }),
    ),
  ).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof ConvexError &&
      (error.data as { code?: string })?.code === ErrorCode.ACCOUNT_ALREADY_LINKED,
  );
});

test("account management is sanitized, owned, and preserves a sign-in method", async () => {
  const t = convexTest(schema);
  const { userId, strangerId, firstAccountId, secondAccountId } = await t.run(async (ctx) => {
    const userId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "managed@example.com" },
    });
    const strangerId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "managed-stranger@example.com" },
    });
    const firstAccountId = await ctx.runMutation(components.auth.account.create, {
      userId,
      provider: "password",
      providerAccountId: "managed@example.com",
      secret: "do-not-return",
    });
    const secondAccountId = await ctx.runMutation(components.auth.account.create, {
      userId,
      provider: "github",
      providerAccountId: "github-managed",
    });
    return { userId, strangerId, firstAccountId, secondAccountId };
  });

  const owner = t.withIdentity({ subject: userId, sid: "account-owner" as any });
  const accounts = await owner.run((ctx) => backendAuth.account.list(ctx as any));
  expect(accounts).toHaveLength(2);
  expect(JSON.stringify(accounts)).not.toContain("do-not-return");
  expect(accounts[0]).not.toHaveProperty("secret");

  const stranger = t.withIdentity({ subject: strangerId, sid: "account-stranger" as any });
  await expect(
    stranger.run((ctx) => backendAuth.account.remove(ctx as any, { id: firstAccountId })),
  ).rejects.toThrow("Account not found");

  await owner.run((ctx) => backendAuth.account.remove(ctx as any, { id: secondAccountId }));
  await expect(
    owner.run((ctx) => backendAuth.account.remove(ctx as any, { id: firstAccountId })),
  ).rejects.toThrow();
});

test("account management leaves WebAuthn backing accounts to the factor API", async () => {
  const t = convexTest(schema);
  const { userId, passkeyAccountId } = await t.run(async (ctx) => {
    const userId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "factor-boundary@example.com" },
    });
    await ctx.runMutation(components.auth.account.create, {
      userId,
      provider: "password",
      providerAccountId: "factor-boundary@example.com",
      secret: "hashed-password",
    });
    await ctx.runMutation(components.auth.factor.passkey.create, {
      userId,
      credentialId: "factor-boundary-credential",
      publicKey: new ArrayBuffer(32),
      algorithm: -7,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      createdAt: Date.now(),
    });
    const passkeyAccount = await ctx.runQuery(components.auth.account.get, {
      provider: "passkey",
      providerAccountId: "factor-boundary-credential",
    });
    return { userId, passkeyAccountId: passkeyAccount!._id };
  });

  const current = t.withIdentity({ subject: userId, sid: "factor-boundary" as any });
  const accounts = await current.run((ctx) => backendAuth.account.list(ctx as any));
  expect(accounts.map((account) => account.provider)).toEqual(["password"]);
  await expect(
    current.run((ctx) => backendAuth.account.remove(ctx as any, { id: passkeyAccountId })),
  ).rejects.toThrow("auth.factor.remove");
});
