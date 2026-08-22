import { api } from "@convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { SignJWT, decodeJwt, importPKCS8 } from "jose";
import { expect, inject, test } from "vite-plus/test";

import { getInteropRuntime, type ConvexSignInResult } from "../helpers.js";

/**
 * Regression guard for the OAuth-access-token-as-Convex-identity contract.
 *
 * MCP tools run the signed-in user's queries via `ctx.runQuery`, which relies on
 * Convex's identity layer accepting the OAuth `at+jwt` as a signed-in user. This
 * test runs against the REAL deployed backend (not in-memory `convexTest`, which
 * fakes `getUserIdentity()` and therefore cannot see this) and isolates the JWT
 * header `typ` as the single variable:
 *
 *   - a real session token (no `typ`)                 -> accepted
 *   - the same claims re-signed with no `typ`         -> accepted
 *   - the same claims re-signed with `typ: "at+jwt"`  -> REJECTED (NOT_SIGNED_IN)
 *
 * The third case is exactly the failure seen end-to-end (`codex mcp` -> tool call
 * -> NOT_SIGNED_IN). It proves Convex's identity layer rejects RFC 9068's
 * `at+jwt` typ, which is why OAuth access tokens must not carry it.
 */
test("Convex identity rejects the at+jwt typ header but accepts the same claims without it", async () => {
  const { convexApiUrl } = getInteropRuntime();
  const convexClient = new ConvexHttpClient(convexApiUrl, {
    skipConvexDeploymentUrlCheck: true,
    logger: false,
  });

  const signInResult = (await convexClient.action(api.auth.signIn, {
    request: { provider: "anonymous" },
  })) as ConvexSignInResult;
  expect(signInResult.kind).toBe("signedIn");
  const sessionToken = signInResult.session?.token;
  if (!sessionToken) {
    throw new Error("Anonymous sign-in did not return a session token.");
  }

  // Control 1: the deployment's own session token is a known-good identity.
  convexClient.setAuth(sessionToken);
  await expect(convexClient.query(api.groups.list, {})).resolves.toBeDefined();

  const claims = decodeJwt(sessionToken);
  const signingKey = await importPKCS8(inject("jwtPrivateKey"), "EdDSA");

  // Control 2: re-signing the identical claims with the deployment key but no
  // `typ` is still accepted — so the key and claims are right and `typ` is the
  // only thing left to vary.
  const reSignedNoTyp = await new SignJWT(claims)
    .setProtectedHeader({ alg: "EdDSA" })
    .sign(signingKey);
  convexClient.setAuth(reSignedNoTyp);
  await expect(convexClient.query(api.groups.list, {})).resolves.toBeDefined();

  // The bug: identical claims + key, only the OAuth access-token `typ` added,
  // and Convex no longer resolves an identity.
  const atJwt = await new SignJWT(claims)
    .setProtectedHeader({ alg: "EdDSA", typ: "at+jwt" })
    .sign(signingKey);
  convexClient.setAuth(atJwt);
  await expect(convexClient.query(api.groups.list, {})).rejects.toThrow(
    /NOT_SIGNED_IN|Authentication required|Could not verify OIDC token claim/,
  );
});
