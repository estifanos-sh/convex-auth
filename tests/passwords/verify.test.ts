/** Integration tests for explicitly configured password reset and verification providers. */

import { api, components } from "@convex/_generated/api";
import schema from "@convex/schema";
import { decodeJwt } from "jose";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { convexTest } from "../convex/setup";
import { expectSignInSession, stubResendCapture, TEST_PASSWORD } from "../helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("reset verification returns a passkey rotation without issuing a session", async () => {
  const t = convexTest(schema);
  const email = "reset-flow@example.com";

  const signUpResult = await t.action(api.auth.signIn, {
    request: { provider: "password", params: { email, password: TEST_PASSWORD, flow: "signUp" } },
  });
  expectSignInSession(signUpResult);

  const resetCapture = stubResendCapture();
  const resetStart = await t.action(api.auth.signIn, {
    request: { provider: "password", params: { email, flow: "reset" } },
  });
  resetCapture.restore();

  expect(resetStart.kind).toBe("started");
  expect(resetCapture.captured()).not.toBeNull();
  expect(resetCapture.code()).not.toEqual("");

  const NEW_PASSWORD = "freshpassword123";
  const accountBefore = await t.run((ctx) =>
    ctx.runQuery(components.auth.account.get, {
      provider: "password",
      providerAccountId: email,
    }),
  );
  const continuation = await t.action(api.auth.signIn, {
    request: {
      provider: "password",
      params: {
        email,
        code: resetCapture.code(),
        newPassword: NEW_PASSWORD,
        flow: "recover",
      },
    },
  });
  expect(continuation.kind).toBe("webauthnOptions");
  if (continuation.kind !== "webauthnOptions" || !("operation" in continuation)) {
    throw new Error("expected passkey rotation");
  }
  expect(continuation.operation).toBe("rotate");
  expect(continuation.continuation).not.toEqual("");

  const accountAfter = await t.run((ctx) =>
    ctx.runQuery(components.auth.account.get, {
      provider: "password",
      providerAccountId: email,
    }),
  );
  expect(accountAfter?.secret).toBe(accountBefore?.secret);
  if (accountAfter === null) throw new Error("expected password account");
  const sessions = await t.run((ctx) =>
    ctx.runQuery(components.auth.session.list, { userId: accountAfter.userId }),
  );
  expect(sessions).toHaveLength(1);

  await expect(
    t.action(api.auth.signIn, {
      request: {
        provider: "password",
        params: {
          email,
          code: resetCapture.code(),
          newPassword: NEW_PASSWORD,
          flow: "recover",
        },
      },
    }),
  ).rejects.toThrow("Invalid code");
});

test("verify without newPassword completes post-signup email confirmation", async () => {
  const t = convexTest(schema);
  const email = "verify-flow@example.com";

  const capture = stubResendCapture();
  const signUpResult = await t.action(api.auth.signIn, {
    request: {
      provider: "password-verified",
      params: { email, password: TEST_PASSWORD, flow: "signUp" },
    },
  });
  capture.restore();
  expect(signUpResult.kind).toBe("started");
  expect(capture.code()).not.toEqual("");

  const tokens = expectSignInSession(
    await t.action(api.auth.signIn, {
      request: {
        provider: "password-verified",
        params: { email, code: capture.code(), flow: "verify" },
      },
    }),
  );
  expect(tokens).not.toBeNull();

  const claims = decodeJwt(tokens!.token);
  expect(claims.email).toBe(email);
  expect(claims.email_verified).toBe(true);

  const reSignIn = expectSignInSession(
    await t.action(api.auth.signIn, {
      request: {
        provider: "password-verified",
        params: { email, password: TEST_PASSWORD, flow: "signIn" },
      },
    }),
  );
  expect(reSignIn).not.toBeNull();
});

test("reset flow does not reveal whether an email is registered", async () => {
  const t = convexTest(schema);

  const capture = stubResendCapture();
  const result = await t.action(api.auth.signIn, {
    request: {
      provider: "password",
      params: { email: "no-such-reset-user@example.com", flow: "reset" },
    },
  });
  capture.restore();

  expect(result.kind).toBe("started");
  expect(capture.code()).toEqual("");
});

test("verify resend flow does not reveal whether an email is registered", async () => {
  const t = convexTest(schema);

  const capture = stubResendCapture();
  const result = await t.action(api.auth.signIn, {
    request: {
      provider: "password-verified",
      params: { email: "no-such-verify-user@example.com", flow: "verify" },
    },
  });
  capture.restore();

  expect(result.kind).toBe("started");
  expect(capture.code()).toEqual("");
});
