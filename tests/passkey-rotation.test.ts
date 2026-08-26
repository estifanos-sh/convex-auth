/**
 * Regression: rotation must not exclude the credentials it is about to delete.
 *
 * `completeRotation` removes every existing passkey for the user once the
 * replacement registers. Listing those same credentials in
 * `excludeCredentials` therefore refuses the one authenticator the ceremony
 * exists to replace — a person holding a single security key can never
 * complete a rotation, and an account that reaches that state cannot be
 * recovered through the enrolment flow at all.
 */

import { api, components } from "@convex/_generated/api";
import schema from "@convex/schema";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";

const EMAIL = "rotation-exclusion@example.com";

function passkeyArgs(userId: string, credentialId: string) {
  return {
    userId: userId as never,
    credentialId,
    publicKey: new ArrayBuffer(32),
    algorithm: -7,
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
    createdAt: Date.now(),
  };
}

async function seedRotation(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.runMutation(components.auth.user.create, {
      data: { email: EMAIL },
    });
    const accountId = await ctx.runMutation(components.auth.account.create, {
      userId,
      provider: "password",
      providerAccountId: EMAIL,
      secret: "old-secret",
    });
    await ctx.runMutation(components.auth.factor.passkey.create, {
      ...passkeyArgs(userId, "only-credential"),
    });
    await ctx.runMutation(components.auth.token.verification.create, {
      accountId,
      provider: "email",
      code: "rotation-reset-code",
      expirationTime: Date.now() + 60_000,
    });
    const recovery = await ctx.runMutation(components.auth.token.continuation.recover, {
      accountId,
      code: "rotation-reset-code",
      maxAttemptsPerHour: 10,
      now: Date.now(),
      passwordProvider: "password",
      provider: "webauthn",
      resetProvider: "email",
      operation: "rotate",
      secret: "new-secret",
      expirationTime: Date.now() + 60_000,
    });
    if (recovery.status !== "accepted") throw new Error("expected accepted recovery");
    return { continuationId: recovery.continuationId };
  });
}

test("rotation does not exclude the credential it is about to replace", async () => {
  const t = convexTest(schema);
  const { continuationId } = await seedRotation(t);

  const options = await t.action(api.auth.signIn, {
    request: { provider: "webauthn", params: { flow: "register" } },
    continuation: continuationId,
  });
  if (options.kind !== "webauthnOptions") throw new Error("expected webauthnOptions");

  const { excludeCredentials } = options.options as {
    excludeCredentials?: Array<{ id: string }>;
  };

  // The user holds exactly one credential; excluding it would make this
  // ceremony unsatisfiable on the only authenticator they own.
  expect(excludeCredentials ?? []).toEqual([]);
});
