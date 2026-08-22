/**
 * Tests for the event-aware deletion helpers exposed on
 * `ctx.auth.{passkey.remove, totp.remove, account.unlink}`.
 *
 * Each helper reads the target document, runs the corresponding component
 * mutation, and the runtime wrapper emits the matching stream-backed auth
 * event. These tests exercise the underlying component mutations directly to verify the
 * deletion + supporting state transitions (e.g. `User.hasTotp`) behave
 * correctly.
 */

import { components } from "@convex/_generated/api";
import schema from "@convex/schema";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";

test("passkey removal removes the passkey row", async () => {
  const t = convexTest(schema);

  const { userId, passkeyId } = await t.run(async (ctx) => {
    const userId = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "passkey-delete@example.com" },
    })) as string;
    const passkeyId = await ctx.runMutation(components.auth.factor.passkey.create, {
      userId: userId as never,
      credentialId: "test-credential-passkey-delete",
      publicKey: new ArrayBuffer(32),
      algorithm: -7,
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      createdAt: Date.now(),
    });
    return { userId, passkeyId };
  });

  const before = await t.run((ctx) =>
    ctx.runQuery(components.auth.factor.passkey.get, { id: passkeyId }),
  );
  expect(before).not.toBeNull();
  expect(before?.userId).toBe(userId);

  await t.run((ctx) => ctx.runMutation(components.auth.factor.passkey.remove, { id: passkeyId }));

  const after = await t.run((ctx) =>
    ctx.runQuery(components.auth.factor.passkey.get, { id: passkeyId }),
  );
  expect(after).toBeNull();
});

test("totp.delete removes the enrollment row", async () => {
  const t = convexTest(schema);

  const { userId, totpId } = await t.run(async (ctx) => {
    const userId = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "totp-delete@example.com" },
    })) as string;
    const secret = new ArrayBuffer(20);
    const totpId = await ctx.runMutation(components.auth.factor.totp.create, {
      userId: userId as never,
      secret,
      digits: 6,
      period: 30,
      verified: false,
      createdAt: Date.now(),
    });
    await ctx.runMutation(components.auth.factor.totp.update, {
      id: totpId,
      patch: { verified: true, lastUsedAt: Date.now() },
    });
    return { userId, totpId };
  });

  const verifiedBefore = await t.run((ctx) =>
    ctx.runQuery(components.auth.factor.totp.get, { verifiedForUserId: userId }),
  );
  expect(verifiedBefore?._id).toBe(totpId);

  await t.run((ctx) => ctx.runMutation(components.auth.factor.totp.remove, { id: totpId }));

  const verifiedAfter = await t.run((ctx) =>
    ctx.runQuery(components.auth.factor.totp.get, { verifiedForUserId: userId }),
  );
  expect(verifiedAfter).toBeNull();

  const totpDoc = await t.run((ctx) =>
    ctx.runQuery(components.auth.factor.totp.get, { id: totpId }),
  );
  expect(totpDoc).toBeNull();
});

test("deleting one verified factor leaves another resolvable", async () => {
  const t = convexTest(schema);

  const { userId, firstTotpId, secondTotpId } = await t.run(async (ctx) => {
    const userId = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "totp-multi@example.com" },
    })) as string;
    const firstTotpId = await ctx.runMutation(components.auth.factor.totp.create, {
      userId: userId as never,
      secret: new ArrayBuffer(20),
      digits: 6,
      period: 30,
      verified: false,
      createdAt: Date.now(),
    });
    await ctx.runMutation(components.auth.factor.totp.update, {
      id: firstTotpId,
      patch: { verified: true, lastUsedAt: Date.now() },
    });
    const secondTotpId = await ctx.runMutation(components.auth.factor.totp.create, {
      userId: userId as never,
      secret: new ArrayBuffer(20),
      digits: 6,
      period: 30,
      verified: false,
      createdAt: Date.now(),
    });
    await ctx.runMutation(components.auth.factor.totp.update, {
      id: secondTotpId,
      patch: { verified: true, lastUsedAt: Date.now() },
    });
    return { userId, firstTotpId, secondTotpId };
  });

  await t.run((ctx) => ctx.runMutation(components.auth.factor.totp.remove, { id: firstTotpId }));

  const stillVerified = await t.run((ctx) =>
    ctx.runQuery(components.auth.factor.totp.get, { verifiedForUserId: userId }),
  );
  expect(stillVerified?._id).toBe(secondTotpId);
});

test("accountDelete removes the account row", async () => {
  const t = convexTest(schema);

  const { accountId } = await t.run(async (ctx) => {
    const userId = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "account-unlink@example.com" },
    })) as string;
    const accountId = await ctx.runMutation(components.auth.account.create, {
      userId: userId as never,
      provider: "google",
      providerAccountId: "google-1234",
    });
    return { userId, accountId };
  });

  const before = await t.run((ctx) => ctx.runQuery(components.auth.account.get, { id: accountId }));
  expect(before).not.toBeNull();
  expect(before?.provider).toBe("google");

  await t.run((ctx) => ctx.runMutation(components.auth.account.remove, { id: accountId }));

  const after = await t.run((ctx) => ctx.runQuery(components.auth.account.get, { id: accountId }));
  expect(after).toBeNull();
});
