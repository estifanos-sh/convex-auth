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

test("user removal invalidates OAuth, device, passkey, and session credentials", async () => {
  const t = convexTest(schema);
  const now = Date.now();
  const { deviceCodeHash, oauthCodeHash, oauthRefreshHash, sessionId, userId } = await t.run(
    async (ctx) => {
      const userId = await ctx.runMutation(components.auth.user.create, {
        data: { email: "remove-credentials@example.com" },
      });
      const session = await ctx.runMutation(components.auth.session.create, {
        userId,
        sessionExpirationTime: now + 60_000,
        refreshTokenExpirationTime: now + 60_000,
      });
      await ctx.runMutation(components.auth.factor.passkey.create, {
        userId,
        credentialId: "remove-credentials-passkey",
        publicKey: new ArrayBuffer(32),
        algorithm: -7,
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
        createdAt: now,
      });
      const deviceCodeHash = "remove-device-code";
      const deviceId = await ctx.runMutation(components.auth.factor.device.create, {
        deviceCodeHash,
        userCode: "REMOVE-DEVICE",
        expiresAt: now + 60_000,
        interval: 5,
        status: "pending",
      });
      await ctx.runMutation(components.auth.factor.device.authorize, {
        id: deviceId,
        userId,
        now,
        sessionExpirationTime: now + 60_000,
      });
      const oauthCodeHash = "remove-oauth-code";
      await ctx.runMutation(components.auth.oauth.code.create, {
        codeHash: oauthCodeHash,
        userId,
        clientId: "remove-client",
        redirectUri: "https://app.example/callback",
        scopes: ["openid"],
        codeChallenge: "challenge",
        expiresAt: now + 60_000,
      });
      const oauthRefreshHash = "remove-oauth-refresh";
      await ctx.runMutation(components.auth.oauth.refresh.create, {
        tokenHash: oauthRefreshHash,
        clientId: "remove-client",
        userId,
        scopes: ["openid"],
        expiresAt: now + 60_000,
      });
      return {
        deviceCodeHash,
        oauthCodeHash,
        oauthRefreshHash,
        sessionId: session.sessionId,
        userId,
      };
    },
  );

  await t.run((ctx) => ctx.runMutation(components.auth.user.remove, { id: userId }));

  const remaining = await t.run(async (ctx) => {
    return await Promise.all([
      ctx.runQuery(components.auth.session.get, { id: sessionId }),
      ctx.runQuery(components.auth.factor.device.get, { deviceCodeHash }),
      ctx.runQuery(components.auth.oauth.code.get, { codeHash: oauthCodeHash }),
      ctx.runQuery(components.auth.oauth.refresh.get, { tokenHash: oauthRefreshHash }),
      ctx.runQuery(components.auth.factor.passkey.list, { userId }),
    ]);
  });
  expect(remaining).toEqual([null, null, null, null, []]);
});

test("an oversized user cascade aborts before any credential row is deleted", async () => {
  const t = convexTest(schema);
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "remove-too-large@example.com" },
    });
    for (let index = 0; index < 101; index++) {
      await ctx.runMutation(components.auth.account.create, {
        userId,
        provider: `provider-${index}`,
        providerAccountId: `account-${index}`,
      });
    }
    return userId;
  });

  await expect(
    t.run((ctx) => ctx.runMutation(components.auth.user.remove, { id: userId })),
  ).rejects.toThrow("CASCADE_TOO_LARGE");

  const [user, accounts] = await t.run(async (ctx) =>
    Promise.all([
      ctx.runQuery(components.auth.user.get, { id: userId }),
      ctx.runQuery(components.auth.account.list, { userId }),
    ]),
  );
  expect(user).not.toBeNull();
  expect(accounts).toHaveLength(101);
});

test("user removal preserves shared OAuth clients and other users' grants", async () => {
  const t = convexTest(schema);
  const now = Date.now();
  const { clientId, otherRefreshHash, ownerId } = await t.run(async (ctx) => {
    const ownerId = await ctx.runMutation(components.auth.user.create, { data: {} });
    const otherUserId = await ctx.runMutation(components.auth.user.create, { data: {} });
    const clientId = "shared-client";
    await ctx.runMutation(components.auth.oauth.client.create, {
      clientId,
      name: "Shared client",
      redirectUris: ["https://app.example/callback"],
      scopes: ["openid"],
      grantTypes: ["authorization_code"],
      tokenEndpointAuthMethod: "none",
      createdBy: ownerId,
    });
    const otherRefreshHash = "other-user-refresh";
    await ctx.runMutation(components.auth.oauth.refresh.create, {
      tokenHash: otherRefreshHash,
      clientId,
      userId: otherUserId,
      scopes: ["openid"],
      expiresAt: now + 60_000,
    });
    return { clientId, otherRefreshHash, ownerId };
  });
  await t.run((ctx) => ctx.runMutation(components.auth.user.remove, { id: ownerId }));
  const [client, token] = await t.run((ctx) =>
    Promise.all([
      ctx.runQuery(components.auth.oauth.client.get, { clientId }),
      ctx.runQuery(components.auth.oauth.refresh.get, { tokenHash: otherRefreshHash }),
    ]),
  );
  expect(client).toMatchObject({ clientId });
  expect(client).not.toHaveProperty("createdBy");
  expect(token).not.toBeNull();
});

test("nested cascade fanout aborts atomically when it exhausts the shared budget", async () => {
  const t = convexTest(schema);
  const now = Date.now();
  const { sessionId, userId } = await t.run(async (ctx) => {
    const userId = await ctx.runMutation(components.auth.user.create, { data: {} });
    const session = await ctx.runMutation(components.auth.session.create, {
      userId,
      sessionExpirationTime: now + 60_000,
    });
    for (let index = 0; index < 100; index++) {
      await ctx.runMutation(components.auth.token.refresh.create, {
        sessionId: session.sessionId,
        expirationTime: now + 60_000,
      });
    }
    return { sessionId: session.sessionId, userId };
  });
  await expect(
    t.run((ctx) => ctx.runMutation(components.auth.user.remove, { id: userId })),
  ).rejects.toThrow("CASCADE_TOO_LARGE");
  const [user, session] = await t.run((ctx) =>
    Promise.all([
      ctx.runQuery(components.auth.user.get, { id: userId }),
      ctx.runQuery(components.auth.session.get, { id: sessionId }),
    ]),
  );
  expect(user).not.toBeNull();
  expect(session).not.toBeNull();
});
