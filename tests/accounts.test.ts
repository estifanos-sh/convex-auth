import { api } from "@convex/_generated/api";
import schema from "@convex/schema";
import { decodeJwt } from "jose";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { convexTest } from "./convex/setup";
import { expectSignInSession, signInViaMagicLink, TEST_EMAIL, TEST_PASSWORD } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("sign in with email signs out existing user with different email", async () => {
  const t = convexTest(schema);

  const tokens = expectSignInSession(
    await t.action(api.auth.signIn, {
      request: {
        provider: "password",
        params: {
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
          flow: "signUp",
        },
      },
    }),
  );

  const claims = decodeJwt(tokens!.token);
  const asMichal = t.withIdentity({ subject: claims.sub, sid: claims.sid as any });

  const newTokens = await signInViaMagicLink(asMichal, "email", "michal@gmail.com");

  expect(newTokens).not.toBeNull();

  expect(getUserIdFromToken(newTokens!.token)).not.toEqual(getUserIdFromToken(tokens!.token));

  const refreshedOldSession = expectSignInSession(
    await t.action(api.auth.signIn, { request: { refreshToken: tokens!.refreshToken } }),
  );
  expect(refreshedOldSession).toBeNull();
});

test("unverified password accounts are not auto-linked to email sign-in", async () => {
  const t = convexTest(schema);

  const tokens = expectSignInSession(
    await t.action(api.auth.signIn, {
      request: {
        provider: "password",
        params: {
          email: "linkme@gmail.com",
          password: TEST_PASSWORD,
          flow: "signUp",
        },
      },
    }),
  );

  const claims = decodeJwt(tokens!.token);
  const asUser = t.withIdentity({ subject: claims.sub, sid: claims.sid as any });

  const newTokens = await signInViaMagicLink(asUser, "email", "linkme@gmail.com");
  expect(newTokens).not.toBeNull();
  expect(getUserIdFromToken(newTokens!.token)).not.toEqual(getUserIdFromToken(tokens!.token));
});

test("automatic linking persists across repeated verified email sign-ins", async () => {
  const t = convexTest(schema);

  const firstTokens = await signInViaMagicLink(t, "email", "repeat@gmail.com");
  expect(firstTokens).not.toBeNull();

  const secondTokens = await signInViaMagicLink(t, "email", "repeat@gmail.com");
  expect(secondTokens).not.toBeNull();

  expect(getUserIdFromToken(secondTokens!.token)).toEqual(getUserIdFromToken(firstTokens!.token));
});

test("no linking to untrusted accounts", async () => {
  const t = convexTest(schema);

  const firstTokens = await signInViaMagicLink(t, "email", "first@gmail.com");
  const secondTokens = await signInViaMagicLink(t, "email", "second@gmail.com");

  expect(firstTokens).not.toBeNull();
  expect(secondTokens).not.toBeNull();
  expect(getUserIdFromToken(secondTokens!.token)).not.toEqual(
    getUserIdFromToken(firstTokens!.token),
  );
});

function getUserIdFromToken(token: string) {
  return decodeJwt(token).sub!;
}
