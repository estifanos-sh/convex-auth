import { api, components } from "@convex/_generated/api";
import { auth } from "@convex/auth";
import schema from "@convex/schema";
import { decodeJwt } from "jose";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { convexTest } from "./convex/setup";
import { expectSignInSession, subjectToUserId, TEST_EMAIL, TEST_PASSWORD } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("sign up with password", async () => {
  const t = convexTest(schema);
  const tokens = expectSignInSession(
    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        flow: "signUp",
      },
    }),
  );

  expect(tokens).not.toBeNull();

  const tokens2 = expectSignInSession(
    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        flow: "signIn",
      },
    }),
  );

  expect(tokens2).not.toBeNull();
  expect(tokens2!.refreshToken).not.toEqual(tokens!.refreshToken);

  await expect(async () => {
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email: TEST_EMAIL, password: "wrong", flow: "signIn" },
    });
  }).rejects.toThrow(/Invalid credentials|InvalidSecret/);

  const claims = decodeJwt(tokens!.token);
  expect(claims.sub).toBeDefined();
  expect(claims.sid).toBeDefined();
  expect(claims.email).toBe(TEST_EMAIL);
  expect(claims.email_verified).toBe(false);

  await t.withIdentity({ subject: claims.sub, sid: claims.sid as any }).action(api.auth.signOut);

  const refreshedFromFirstSession = expectSignInSession(
    await t.action(api.auth.signIn, {
      refreshToken: tokens!.refreshToken,
      params: {},
    }),
  );
  expect(refreshedFromFirstSession).toBeNull();

  const refreshedFromSecondSession = expectSignInSession(
    await t.action(api.auth.signIn, {
      refreshToken: tokens2!.refreshToken,
      params: {},
    }),
  );
  expect(refreshedFromSecondSession).not.toBeNull();

  const claims2 = decodeJwt(tokens2!.token);
  await t.withIdentity({ subject: claims2.sub, sid: claims2.sid as any }).action(api.auth.signOut);

  const refreshedAfterSecondSignOut = expectSignInSession(
    await t.action(api.auth.signIn, {
      refreshToken: tokens2!.refreshToken,
      params: {},
    }),
  );
  expect(refreshedAfterSecondSignOut).toBeNull();
});

test("sign up with password keeps email unverified by default", async () => {
  const t = convexTest(schema);
  const tokens = expectSignInSession(
    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        email: "unverified@gmail.com",
        password: TEST_PASSWORD,
        flow: "signUp",
      },
    }),
  );

  const claims = decodeJwt(tokens!.token);
  const viewer = await t.run(async (ctx) => {
    return await auth.user.get(ctx as any, { id: subjectToUserId(claims.sub) });
  });

  expect(viewer?.email).toBe("unverified@gmail.com");
  expect(viewer?.emailVerificationTime).toBeUndefined();
});

test("password sign up requires email", async () => {
  const t = convexTest(schema);

  await expect(async () => {
    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        password: TEST_PASSWORD,
        flow: "signUp",
      },
    } as never);
  }).rejects.toThrow(/Invalid parameters for credentials provider password/);
});

test("change password requires authentication", async () => {
  const t = convexTest(schema);

  await expect(async () => {
    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        email: TEST_EMAIL,
        currentPassword: TEST_PASSWORD,
        newPassword: "newpass123",
        flow: "change",
      },
    });
  }).rejects.toThrow(/Sign in first|NOT_SIGNED_IN/);
});

test("change password rotates secret and invalidates other sessions", async () => {
  const t = convexTest(schema);

  const sessionA = expectSignInSession(
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email: TEST_EMAIL, password: TEST_PASSWORD, flow: "signUp" },
    }),
  );

  const sessionB = expectSignInSession(
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email: TEST_EMAIL, password: TEST_PASSWORD, flow: "signIn" },
    }),
  );

  const claimsA = decodeJwt(sessionA!.token);
  const asUserA = t.withIdentity({ subject: claimsA.sub, sid: claimsA.sid as any });

  const NEW_PASSWORD = "newpassword123";
  const changeResult = expectSignInSession(
    await asUserA.action(api.auth.signIn, {
      provider: "password",
      params: {
        email: TEST_EMAIL,
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
        flow: "change",
      },
    }),
  );
  expect(changeResult).not.toBeNull();

  await expect(async () => {
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email: TEST_EMAIL, password: TEST_PASSWORD, flow: "signIn" },
    });
  }).rejects.toThrow(/Invalid credentials/);

  const newSession = expectSignInSession(
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email: TEST_EMAIL, password: NEW_PASSWORD, flow: "signIn" },
    }),
  );
  expect(newSession).not.toBeNull();

  const refreshedB = expectSignInSession(
    await t.action(api.auth.signIn, {
      refreshToken: sessionB!.refreshToken,
      params: {},
    }),
  );
  expect(refreshedB).toBeNull();
});

test("change password works for authenticated TOTP users", async () => {
  const t = convexTest(schema);

  const session = expectSignInSession(
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email: TEST_EMAIL, password: TEST_PASSWORD, flow: "signUp" },
    }),
  );
  const claims = decodeJwt(session!.token);
  const userId = subjectToUserId(claims.sub);

  await t.run(async (ctx) => {
    const totpId = await ctx.runMutation(components.auth.factor.totp.create, {
      userId: userId as never,
      secret: new ArrayBuffer(20),
      digits: 6,
      period: 30,
      verified: false,
      createdAt: Date.now(),
    });
    await ctx.runMutation(components.auth.factor.totp.update, {
      id: totpId,
      patch: { verified: true, lastUsedAt: Date.now() },
    });
  });

  const NEW_PASSWORD = "newpassword123";
  const changeResult = expectSignInSession(
    await t.withIdentity({ subject: claims.sub, sid: claims.sid as any }).action(api.auth.signIn, {
      provider: "password",
      params: {
        email: TEST_EMAIL,
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
        flow: "change",
      },
    }),
  );
  expect(changeResult).not.toBeNull();

  await expect(async () => {
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email: TEST_EMAIL, password: TEST_PASSWORD, flow: "signIn" },
    });
  }).rejects.toThrow(/Invalid credentials/);

  const sessionsBeforeChallenge = await t.run((ctx) =>
    ctx.runQuery(components.auth.session.list, { userId: userId as never }),
  );
  const result = await t.action(api.auth.signIn, {
    provider: "password",
    params: { email: TEST_EMAIL, password: NEW_PASSWORD, flow: "signIn" },
  });
  expect(result.kind).toBe("totpRequired");
  const sessionsAfterChallenge = await t.run((ctx) =>
    ctx.runQuery(components.auth.session.list, { userId: userId as never }),
  );
  expect(sessionsAfterChallenge).toHaveLength(sessionsBeforeChallenge.length);
});

test("change password rejects wrong current password", async () => {
  const t = convexTest(schema);

  const tokens = expectSignInSession(
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email: TEST_EMAIL, password: TEST_PASSWORD, flow: "signUp" },
    }),
  );
  const claims = decodeJwt(tokens!.token);
  const asUser = t.withIdentity({ subject: claims.sub, sid: claims.sid as any });

  await expect(async () => {
    await asUser.action(api.auth.signIn, {
      provider: "password",
      params: {
        email: TEST_EMAIL,
        currentPassword: "wrong-password",
        newPassword: "newpass123",
        flow: "change",
      },
    });
  }).rejects.toThrow(/Invalid current password|Invalid credentials/);
});

test("change password rejects email mismatch with authenticated user", async () => {
  const t = convexTest(schema);

  await t.action(api.auth.signIn, {
    provider: "password",
    params: { email: "alice@example.com", password: TEST_PASSWORD, flow: "signUp" },
  });

  const tokensB = expectSignInSession(
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email: "bob@example.com", password: TEST_PASSWORD, flow: "signUp" },
    }),
  );

  const claimsB = decodeJwt(tokensB!.token);
  const asUserB = t.withIdentity({ subject: claimsB.sub, sid: claimsB.sid as any });

  await expect(async () => {
    await asUserB.action(api.auth.signIn, {
      provider: "password",
      params: {
        email: "alice@example.com",
        currentPassword: TEST_PASSWORD,
        newPassword: "hijacked123",
        flow: "change",
      },
    });
  }).rejects.toThrow(/Email does not match|Invalid/);
});

test("change password validates new password requirements", async () => {
  const t = convexTest(schema);
  const tokens = expectSignInSession(
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email: TEST_EMAIL, password: TEST_PASSWORD, flow: "signUp" },
    }),
  );
  const claims = decodeJwt(tokens!.token);
  const asUser = t.withIdentity({ subject: claims.sub, sid: claims.sid as any });

  await expect(async () => {
    await asUser.action(api.auth.signIn, {
      provider: "password",
      params: {
        email: TEST_EMAIL,
        currentPassword: TEST_PASSWORD,
        newPassword: "short",
        flow: "change",
      },
    });
  }).rejects.toThrow("Invalid password");
});

test("verify fails when the email verification provider is not configured", async () => {
  const t = convexTest(schema);
  await expect(async () => {
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email: TEST_EMAIL, code: "123456", flow: "verify" },
    });
  }).rejects.toThrow(/Email verification is not enabled/);
});

test("invalid flow name surfaces a clear error", async () => {
  const t = convexTest(schema);
  await expect(async () => {
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email: TEST_EMAIL, password: TEST_PASSWORD, flow: "bogus" },
    } as never);
  }).rejects.toThrow(/Invalid parameters for credentials provider password/);
});
