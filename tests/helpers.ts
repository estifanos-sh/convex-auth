import { api } from "@convex/_generated/api";
import { expect, vi } from "vite-plus/test";

import type { TestConvexForDataModel } from "./convex/setup";

export const TEST_EMAIL = "sarah@gmail.com";
export const TEST_PASSWORD = "44448888";
export const RESEND_API_URL = "https://api.resend.com/emails";
export const MOCK_EMAIL_ID = "email_123";

/**
 * Assert that a sign-in result has kind "signedIn" and return the session tokens.
 * Returns `null` when the server indicates no active session.
 */
export function expectSignInSession(result: {
  kind: string;
  session?: { token: string; refreshToken: string } | null;
}) {
  expect(result.kind).toBe("signedIn");
  return result.kind === "signedIn" ? (result.session ?? null) : null;
}

export function subjectToUserId(subject: unknown) {
  if (typeof subject !== "string" || subject.length === 0) {
    throw new Error("Expected subject claim");
  }
  return subject;
}

/**
 * Perform a full magic-link email sign-in flow: send the OTP email via a
 * stubbed `fetch`, extract the code, then exchange it for tokens.
 */
export async function signInViaMagicLink(
  t: TestConvexForDataModel<any>,
  provider: "email",
  email: string,
) {
  let code = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      if (typeof input === "string" && input === RESEND_API_URL) {
        const body = String(init.body ?? "");
        code = body.match(/\?code=([^\s\\]+)/)?.[1] ?? "";
        expect(code).not.toEqual("");
        return new Response(JSON.stringify({ id: MOCK_EMAIL_ID }), {
          status: 200,
        });
      }
      throw new Error("Unexpected fetch");
    }),
  );

  await t.action(api.auth.signIn, { provider, params: { email } });
  vi.unstubAllGlobals();

  const result = await t.action(api.auth.signIn, {
    params: { code },
  });
  return expectSignInSession(result);
}

/**
 * Stub `fetch` so calls to Resend capture and return the OTP code embedded in
 * the email body. Returns a getter for the captured code and a teardown.
 */
export function stubResendCapture() {
  let code = "";
  let captured: { headers?: Record<string, string>; body?: unknown } | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      if (typeof input === "string" && input === RESEND_API_URL) {
        captured = init as { headers?: Record<string, string>; body?: unknown };
        const rawBody = (init as { body?: unknown }).body;
        const body = typeof rawBody === "string" ? rawBody : "";
        code = body.match(/\?code=([^\s\\]+)/)?.[1] ?? "";
        return new Response(JSON.stringify({ id: MOCK_EMAIL_ID }), { status: 200 });
      }
      throw new Error("Unexpected fetch");
    }),
  );
  return {
    code: () => code,
    captured: () => captured,
    restore: () => vi.unstubAllGlobals(),
  };
}
