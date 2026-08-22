import { components, internal } from "@convex/_generated/api";
import schema from "@convex/schema";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";

test("a passkey sign-in continuation is user-bound and issues its session only after assertion", async () => {
  const t = convexTest(schema);
  const state = await t.run(async (ctx) => {
    const userId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "credential-continuation@example.com" },
    });
    const passkeyId = await ctx.runMutation(components.auth.factor.passkey.create, {
      userId,
      credentialId: "credential-continuation-key",
      publicKey: new ArrayBuffer(32),
      algorithm: -7,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      createdAt: Date.now(),
    });
    const continuationId = await ctx.runMutation(components.auth.token.continuation.create, {
      userId,
      provider: "webauthn",
      operation: "signIn",
      expirationTime: Date.now() + 60_000,
    });
    const begun = await ctx.runMutation(components.auth.factor.passkey.beginSignIn, {
      continuation: { id: continuationId, provider: "webauthn" },
      signature: "credential-continuation-challenge",
      expirationTime: Date.now() + 60_000,
    });
    const assertion = await ctx.runMutation(components.auth.factor.passkey.beginAssertion, {
      verifierId: begun.verifierId,
      expectedChallenge: "credential-continuation-challenge",
      credentialId: "credential-continuation-key",
    });
    const sessionsBefore = await ctx.runQuery(components.auth.session.list, { userId });
    return { userId, passkeyId, continuationId, assertion, sessionsBefore };
  });

  expect(state.sessionsBefore).toHaveLength(0);
  expect(state.assertion.verifierAccepted).toBe(true);
  expect(state.assertion.continuationId).toBe(state.continuationId);
  expect(state.assertion.passkey?._id).toBe(state.passkeyId);

  const completed = await t.run((ctx) =>
    ctx.runMutation(components.auth.factor.passkey.completeAssertion, {
      id: state.passkeyId,
      counter: 0,
      lastUsedAt: Date.now(),
      backedUp: false,
      continuation: { id: state.continuationId, provider: "webauthn" },
      sessionExpirationTime: Date.now() + 60_000,
      refreshTokenExpirationTime: Date.now() + 60_000,
    }),
  );
  expect(completed.status).toBe("accepted");

  const settled = await t.run(async (ctx) => ({
    continuation: await ctx.runQuery(components.auth.token.continuation.get, {
      id: state.continuationId,
      now: Date.now(),
    }),
    sessions: await ctx.runQuery(components.auth.session.list, { userId: state.userId }),
  }));
  expect(settled.continuation).toBeNull();
  expect(settled.sessions).toHaveLength(1);
});

test("abandoning credentials enrollment leaves no user, account, or session", async () => {
  const t = convexTest(schema);
  const now = Date.now();
  const continuationId = await t.run((ctx) =>
    ctx.runMutation(components.auth.token.enrollment.create, {
      provider: "pin",
      providerAccountId: "abandoned@example.com",
      secret: "already-hashed",
      profile: {
        email: "abandoned@example.com",
        emailVerified: true,
        name: "Abandoned",
      },
      shouldLinkViaEmail: true,
      shouldLinkViaPhone: false,
      targetProvider: "webauthn",
      expirationTime: now + 60_000,
    }),
  );

  const state = await t.run(async (ctx) => ({
    enrollment: await ctx.runQuery(components.auth.token.enrollment.get, {
      continuationId,
      provider: "webauthn",
      now,
    }),
    account: await ctx.runQuery(components.auth.account.get, {
      provider: "pin",
      providerAccountId: "abandoned@example.com",
    }),
    user: await ctx.runQuery(components.auth.user.get, {
      verifiedEmail: "abandoned@example.com",
    }),
  }));

  expect(state.enrollment?.secret).toBe("already-hashed");
  expect(state.account).toBeNull();
  expect(state.user).toBeNull();
});

test("failed credentials enrollment does not consume its continuation", async () => {
  const t = convexTest(schema);
  const now = Date.now();
  const state = await t.run(async (ctx) => {
    const continuationId = await ctx.runMutation(components.auth.token.enrollment.create, {
      provider: "pin",
      providerAccountId: "failure@example.com",
      secret: "already-hashed",
      profile: { email: "failure@example.com" },
      shouldLinkViaEmail: true,
      shouldLinkViaPhone: false,
      targetProvider: "webauthn",
      expirationTime: now + 60_000,
    });
    const enrollment = await ctx.runQuery(components.auth.token.enrollment.get, {
      continuationId,
      provider: "webauthn",
      now,
    });
    if (enrollment === null) throw new Error("expected enrollment");
    const userId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "unrelated@example.com" },
    });
    const credentialsAccountId = await ctx.runMutation(components.auth.account.create, {
      userId,
      provider: "other",
      providerAccountId: "failure@example.com",
    });
    return { continuationId, enrollmentId: enrollment._id, userId, credentialsAccountId };
  });

  const completed = await t.run((ctx) =>
    ctx.runMutation(components.auth.factor.passkey.completeEnrollment, {
      userId: state.userId,
      credentialId: "failed-passkey",
      publicKey: new ArrayBuffer(32),
      algorithm: -7,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      createdAt: now,
      continuationId: state.continuationId,
      enrollmentId: state.enrollmentId,
      credentialsAccountId: state.credentialsAccountId,
      provider: "webauthn",
      now,
      sessionExpirationTime: now + 60_000,
      refreshTokenExpirationTime: now + 60_000,
    }),
  );

  expect(completed.status).toBe("rejected");
  const enrollment = await t.run((ctx) =>
    ctx.runQuery(components.auth.token.enrollment.get, {
      continuationId: state.continuationId,
      provider: "webauthn",
      now,
    }),
  );
  expect(enrollment?._id).toBe(state.enrollmentId);
});

test("the app store rolls back credentials materialization when passkey completion fails", async () => {
  const t = convexTest(schema);
  const now = Date.now();
  const state = await t.run(async (ctx) => {
    const attackerUserId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "attacker@example.com" },
    });
    await ctx.runMutation(components.auth.factor.passkey.create, {
      userId: attackerUserId,
      credentialId: "already-owned-passkey",
      publicKey: new ArrayBuffer(32),
      algorithm: -7,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      createdAt: now,
    });
    const continuationId = await ctx.runMutation(components.auth.token.enrollment.create, {
      provider: "password",
      providerAccountId: "rollback@example.com",
      secret: "already-hashed",
      profile: {
        email: "rollback@example.com",
        emailVerified: true,
        name: "Rollback",
      },
      shouldLinkViaEmail: true,
      shouldLinkViaPhone: false,
      targetProvider: "webauthn",
      expirationTime: now + 60_000,
    });
    return { attackerUserId, continuationId };
  });

  await expect(
    t.mutation(internal.auth.store, {
      args: {
        type: "completeCredentialEnrollment",
        continuationId: state.continuationId,
        provider: "webauthn",
        credentialId: "already-owned-passkey",
        publicKey: new ArrayBuffer(32),
        algorithm: -7,
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
        createdAt: now,
        now,
        sessionExpirationTime: now + 60_000,
        refreshTokenExpirationTime: now + 60_000,
      },
    }),
  ).rejects.toThrow("already registered to another account");

  const settled = await t.run(async (ctx) => ({
    enrollment: await ctx.runQuery(components.auth.token.enrollment.get, {
      continuationId: state.continuationId,
      provider: "webauthn",
      now,
    }),
    account: await ctx.runQuery(components.auth.account.get, {
      provider: "password",
      providerAccountId: "rollback@example.com",
    }),
    user: await ctx.runQuery(components.auth.user.get, {
      verifiedEmail: "rollback@example.com",
    }),
    attackerPasskeys: await ctx.runQuery(components.auth.factor.passkey.list, {
      userId: state.attackerUserId,
    }),
    attackerSessions: await ctx.runQuery(components.auth.session.list, {
      userId: state.attackerUserId,
    }),
  }));
  expect(settled.enrollment).not.toBeNull();
  expect(settled.account).toBeNull();
  expect(settled.user).toBeNull();
  expect(settled.attackerPasskeys).toHaveLength(1);
  expect(settled.attackerSessions).toHaveLength(0);
});

test("credentials enrollment is single-use under concurrent completion", async () => {
  const t = convexTest(schema);
  const now = Date.now();
  const state = await t.run(async (ctx) => {
    const continuationId = await ctx.runMutation(components.auth.token.enrollment.create, {
      provider: "pin",
      providerAccountId: "race@example.com",
      secret: "already-hashed",
      profile: { email: "race@example.com" },
      shouldLinkViaEmail: true,
      shouldLinkViaPhone: false,
      targetProvider: "webauthn",
      expirationTime: now + 60_000,
    });
    const enrollment = await ctx.runQuery(components.auth.token.enrollment.get, {
      continuationId,
      provider: "webauthn",
      now,
    });
    if (enrollment === null) throw new Error("expected enrollment");
    const userId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "race@example.com" },
    });
    const credentialsAccountId = await ctx.runMutation(components.auth.account.create, {
      userId,
      provider: "pin",
      providerAccountId: "race@example.com",
      secret: "already-hashed",
    });
    return { continuationId, enrollmentId: enrollment._id, userId, credentialsAccountId };
  });
  const args = {
    userId: state.userId,
    credentialId: "race-passkey",
    publicKey: new ArrayBuffer(32),
    algorithm: -7,
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
    createdAt: now,
    continuationId: state.continuationId,
    enrollmentId: state.enrollmentId,
    credentialsAccountId: state.credentialsAccountId,
    provider: "webauthn",
    now,
    sessionExpirationTime: now + 60_000,
    refreshTokenExpirationTime: now + 60_000,
  };

  const results = await Promise.all([
    t.run((ctx) => ctx.runMutation(components.auth.factor.passkey.completeEnrollment, args)),
    t.run((ctx) => ctx.runMutation(components.auth.factor.passkey.completeEnrollment, args)),
  ]);

  expect(
    results.map((result: { status: "accepted" | "rejected" }) => result.status).sort(),
  ).toEqual(["accepted", "rejected"]);
  const settled = await t.run(async (ctx) => ({
    passkeys: await ctx.runQuery(components.auth.factor.passkey.list, {
      userId: state.userId,
    }),
    sessions: await ctx.runQuery(components.auth.session.list, { userId: state.userId }),
  }));
  expect(settled.passkeys).toHaveLength(1);
  expect(settled.sessions).toHaveLength(1);
});
