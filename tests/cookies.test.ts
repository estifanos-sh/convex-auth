import {
  SHARED_COOKIE_OPTIONS,
  decodeOAuthState,
  encodeOAuthState,
  redirectToParamCookie,
} from "@estifanos-sh/convex-auth/server/cookies";
import { expect, test } from "vite-plus/test";

// The OAuth flow cookies must ride cross-site redirect chains while staying
// isolated per top-level site. Downgrading any of these flags (dropping
// `httpOnly`, `secure`, `partitioned`, or relaxing `sameSite` away from
// "none") silently weakens CSRF / CHIPS isolation, so pin them.

test("SHARED_COOKIE_OPTIONS carries the cross-site hardening flags", () => {
  expect(SHARED_COOKIE_OPTIONS.httpOnly).toBe(true);
  expect(SHARED_COOKIE_OPTIONS.secure).toBe(true);
  expect(SHARED_COOKIE_OPTIONS.sameSite).toBe("none");
  expect(SHARED_COOKIE_OPTIONS.partitioned).toBe(true);
  expect(SHARED_COOKIE_OPTIONS.path).toBe("/");
});

test("the cookie writer propagates the hardened flags to emitted cookies", () => {
  // Guards against a writer that spreads a downgraded options object.
  const cookie = redirectToParamCookie("google", "/dashboard");
  expect(cookie.options.httpOnly).toBe(true);
  expect(cookie.options.secure).toBe(true);
  expect(cookie.options.sameSite).toBe("none");
  expect(cookie.options.partitioned).toBe(true);
  expect(cookie.options.path).toBe("/");
  // A finite lifetime is layered on top without clobbering the shared flags.
  expect(typeof cookie.options.maxAge).toBe("number");
});

// `redirectTo` rides inside the state parameter so it survives redirect chains
// when cookies are blocked, and `decodeOAuthState` swallows every failure in a
// bare `catch` — a decode that breaks does not raise, it silently drops the
// user on the default page after sign-in. Pin the round trip across all three
// base64 padding remainders so a stricter decoder cannot regress it quietly.
test("OAuth state round-trips at every base64 padding length", () => {
  for (const redirectTo of [
    "/a",
    "/ab",
    "/abc",
    "/abcd",
    "/workbench/people?tab=all",
    "https://app.example.com/deep/link/with/segments",
  ]) {
    const encoded = encodeOAuthState("state-token", redirectTo);
    expect(encoded).not.toContain("=");
    expect(decodeOAuthState(encoded)).toEqual({ state: "state-token", redirectTo });
  }
});

test("OAuth state round-trips a null redirectTo", () => {
  const encoded = encodeOAuthState("state-token", null);
  expect(decodeOAuthState(encoded)).toEqual({ state: "state-token", redirectTo: null });
});

test("malformed OAuth state decodes to null rather than throwing", () => {
  for (const value of ["", "!!!!", "bm90LWpzb24"]) {
    expect(decodeOAuthState(value)).toBeNull();
  }
});
