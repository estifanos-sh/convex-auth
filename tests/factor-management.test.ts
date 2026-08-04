import { components } from "@convex/_generated/api";
import { auth as backendAuth } from "@convex/auth";
import schema from "@convex/schema";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";

test("factor management returns sanitized current-user summaries", async () => {
  const t = convexTest(schema);
  const userId = await t.run(async (ctx) => {
    const id = await ctx.runMutation(components.auth.user.create, {
      data: { email: "factors@example.com" },
    });
    await ctx.runMutation(components.auth.factor.passkey.create, {
      userId: id,
      credentialId: "credential-secret-id",
      publicKey: new ArrayBuffer(32),
      algorithm: -7,
      counter: 7,
      deviceType: "multiDevice",
      backedUp: true,
      name: "Laptop",
      createdAt: 100,
    });
    await ctx.runMutation(components.auth.factor.totp.create, {
      userId: id,
      secret: new ArrayBuffer(20),
      digits: 6,
      period: 30,
      verified: true,
      name: "Authenticator",
      createdAt: 200,
    });
    return id;
  });

  const factors = await t
    .withIdentity({ subject: userId, sid: "factor-session" as any })
    .run((ctx) => backendAuth.factor.list(ctx as any));

  expect(factors.map((factor) => factor.kind)).toEqual(["totp", "webauthn"]);
  const serialized = JSON.stringify(factors);
  expect(serialized).not.toContain("credential-secret-id");
  expect(serialized).not.toContain("publicKey");
  expect(serialized).not.toContain("secret");
  expect(serialized).not.toContain("counter");
});

test("factor update and removal enforce current-user ownership", async () => {
  const t = convexTest(schema);
  const { ownerId, strangerId, passkeyId } = await t.run(async (ctx) => {
    const ownerId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "factor-owner@example.com" },
    });
    const strangerId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "factor-stranger@example.com" },
    });
    const passkeyId = await ctx.runMutation(components.auth.factor.passkey.create, {
      userId: ownerId,
      credentialId: "owned-credential",
      publicKey: new ArrayBuffer(32),
      algorithm: -7,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      createdAt: Date.now(),
    });
    await ctx.runMutation(components.auth.account.create, {
      userId: ownerId,
      provider: "password",
      providerAccountId: "factor-owner@example.com",
      secret: "hashed-password",
    });
    return { ownerId, strangerId, passkeyId };
  });

  const stranger = t.withIdentity({ subject: strangerId, sid: "stranger-session" as any });
  await expect(
    stranger.run((ctx) =>
      backendAuth.factor.update(ctx as any, {
        kind: "webauthn",
        id: passkeyId,
        patch: { name: "Stolen" },
      }),
    ),
  ).rejects.toThrow("Passkey not found");

  const owner = t.withIdentity({ subject: ownerId, sid: "owner-session" as any });
  await owner.run((ctx) =>
    backendAuth.factor.remove(ctx as any, { kind: "webauthn", id: passkeyId }),
  );
  const factors = await owner.run((ctx) => backendAuth.factor.list(ctx as any));
  expect(factors).toEqual([]);
});

test("factor management refuses to remove the last sign-in method", async () => {
  const t = convexTest(schema);
  const { userId, passkeyId } = await t.run(async (ctx) => {
    const userId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "last-factor@example.com" },
    });
    const passkeyId = await ctx.runMutation(components.auth.factor.passkey.create, {
      userId,
      credentialId: "last-factor-credential",
      publicKey: new ArrayBuffer(32),
      algorithm: -7,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      createdAt: Date.now(),
    });
    return { userId, passkeyId };
  });

  const current = t.withIdentity({ subject: userId, sid: "last-factor" as any });
  await expect(
    current.run((ctx) =>
      backendAuth.factor.remove(ctx as any, { kind: "webauthn", id: passkeyId }),
    ),
  ).rejects.toThrow("last sign-in method");
});
