import { components } from "@convex/_generated/api";
import { auth as backendAuth } from "@convex/auth";
import schema from "@convex/schema";
import { ErrorCode } from "@estifanos-sh/convex-auth/shared/codes";
import { createAuthTest } from "@estifanos-sh/convex-auth/test";
import { ConvexError } from "convex/values";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";

test("provider account creation is idempotent for the same user", async () => {
  const t = convexTest(schema);
  const auth = createAuthTest(t, components.auth);
  const userId = await auth.user.create({ data: { email: "link-idempotent@example.com" } });

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
  const auth = createAuthTest(t, components.auth);
  const userA = await auth.user.create({ data: { email: "owner@example.com" } });
  const userB = await auth.user.create({ data: { email: "intruder@example.com" } });

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
  const auth = createAuthTest(t, components.auth);
  const userId = await auth.user.create({ data: { email: "managed@example.com" } });
  const strangerId = await auth.user.create({
    data: { email: "managed-stranger@example.com" },
  });
  await t.run(async (ctx) => {
    await ctx.runMutation(components.auth.account.create, {
      userId,
      provider: "password",
      providerAccountId: "managed@example.com",
      secret: "do-not-return",
    });
    await ctx.runMutation(components.auth.account.create, {
      userId,
      provider: "github",
      providerAccountId: "github-managed",
    });
  });

  const ownerSession = await auth.session.create({ userId });
  const strangerSession = await auth.session.create({ userId: strangerId });
  const owner = t.withIdentity(ownerSession.identity);
  const accounts = await owner.run((ctx) => backendAuth.account.list(ctx));
  expect(accounts).toHaveLength(2);
  expect(JSON.stringify(accounts)).not.toContain("do-not-return");
  expect(accounts[0]).not.toHaveProperty("secret");
  const passwordAccount = accounts.find((account) => account.provider === "password");
  const githubAccount = accounts.find((account) => account.provider === "github");
  if (passwordAccount === undefined || githubAccount === undefined) {
    throw new Error("Expected both password and GitHub accounts.");
  }

  const stranger = t.withIdentity(strangerSession.identity);
  await expect(
    stranger.run((ctx) => backendAuth.account.remove(ctx, { id: passwordAccount.id })),
  ).rejects.toThrow("Account not found");

  await owner.run((ctx) => backendAuth.account.remove(ctx, { id: githubAccount.id }));
  await expect(
    owner.run((ctx) => backendAuth.account.remove(ctx, { id: passwordAccount.id })),
  ).rejects.toThrow();
});

test("account management batches safe capabilities for user lists", async () => {
  const t = convexTest(schema);
  const auth = createAuthTest(t, components.auth);
  const firstUserId = await auth.user.create({ data: { email: "batch-first@example.com" } });
  const secondUserId = await auth.user.create({ data: { email: "batch-second@example.com" } });
  await t.run(async (ctx) => {
    await ctx.runMutation(components.auth.account.create, {
      userId: firstUserId,
      provider: "password",
      providerAccountId: "batch-first@example.com",
      secret: "do-not-return",
      extend: { private: "also-do-not-return" },
    });
    await ctx.runMutation(components.auth.account.create, {
      userId: secondUserId,
      provider: "password",
      providerAccountId: "batch-second@example.com",
      secret: "also-do-not-return",
    });
    await ctx.runMutation(components.auth.account.create, {
      userId: secondUserId,
      provider: "github",
      providerAccountId: "batch-second-github",
    });
  });

  const accounts = await t.run((ctx) =>
    backendAuth.account.list(ctx, {
      userIds: [firstUserId, secondUserId, firstUserId],
      provider: "password",
    }),
  );

  expect(accounts).toHaveLength(2);
  expect(accounts.map((account) => account.userId).sort()).toEqual(
    [firstUserId, secondUserId].sort(),
  );
  expect(JSON.stringify(accounts)).not.toContain("do-not-return");
  expect(JSON.stringify(accounts)).not.toContain("also-do-not-return");
  expect(accounts.map((account) => account.provider)).toEqual(["password", "password"]);
  expect(accounts[0]).not.toHaveProperty("providerAccountId");
  expect(accounts[0]).not.toHaveProperty("secret");
  expect(accounts[0]).not.toHaveProperty("extend");
});

test("account management hides WebAuthn backing accounts from the application facade", async () => {
  const t = convexTest(schema);
  const auth = createAuthTest(t, components.auth);
  const userId = await auth.user.create({ data: { email: "factor-boundary@example.com" } });
  await t.run(async (ctx) => {
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
  });

  const session = await auth.session.create({ userId });
  const current = t.withIdentity(session.identity);
  const accounts = await current.run((ctx) => backendAuth.account.list(ctx));
  expect(accounts.map((account) => account.provider)).toEqual(["password"]);
  const passkeys = await t.run((ctx) =>
    ctx.runQuery(components.auth.factor.passkey.list, { userId }),
  );
  expect(passkeys).toHaveLength(1);
});
