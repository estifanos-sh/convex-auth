import { api } from "@convex/_generated/api";
import { auth } from "@convex/auth";
import schema from "@convex/schema";
import { decodeJwt } from "jose";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { convexTest } from "./convex/setup";
import { expectSignInSession, signInViaMagicLink, subjectToUserId } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("sign in anonymously", async () => {
  const t = convexTest(schema);
  const tokens = expectSignInSession(
    await t.action(api.auth.signIn, { request: { provider: "anonymous" } }),
  );
  expect(tokens).not.toBeNull();
});

test("anonymous sign-in is not auto-converted during email sign-in", async () => {
  const t = convexTest(schema);
  const tokens = expectSignInSession(
    await t.action(api.auth.signIn, { request: { provider: "anonymous" } }),
  );
  const claims = decodeJwt(tokens!.token);
  const asAnonymous = t.withIdentity({ subject: claims.sub, sid: claims.sid as any });
  const newTokens = await signInViaMagicLink(asAnonymous, "email", "mike@gmail.com");
  expect(newTokens).not.toBeNull();

  const newClaims = decodeJwt(newTokens!.token);
  expect(newClaims.sub).not.toEqual(claims.sub);

  const oldViewer = await t.run(async (ctx) => {
    return await auth.user.get(ctx as any, { id: subjectToUserId(claims.sub) });
  });
  expect(oldViewer?.isAnonymous).toEqual(true);

  const viewer = await t.run(async (ctx) => {
    return await auth.user.get(ctx as any, { id: subjectToUserId(newClaims.sub) });
  });
  expect(viewer).toMatchObject({ email: "mike@gmail.com" });
  expect(viewer?.isAnonymous).not.toEqual(true);
});

test("a provider reachable only through `extraProviders` can create its account", async () => {
  const t = convexTest(schema);
  const tokens = expectSignInSession(
    await t.action(api.auth.signIn, { request: { provider: "preview" } }),
  );
  expect(tokens).not.toBeNull();

  const claims = decodeJwt(tokens!.token);
  const viewer = await t.run(async (ctx) => {
    return await auth.user.get(ctx as any, { id: subjectToUserId(claims.sub) });
  });
  expect(viewer?.isAnonymous).toEqual(true);
});

test("an extra provider is still not directly reachable from the client", async () => {
  const t = convexTest(schema);

  await expect(
    t.action(api.auth.signIn, { request: { provider: "guest" } } as never),
  ).rejects.toThrow(/literal|provider|argument/i);
});
