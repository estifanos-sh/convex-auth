/**
 * Passkey (WebAuthn) tests.
 *
 * WebAuthn uses a one-time challenge, proof of private-key possession, and an
 * atomic signature-counter transition. Unlike password and TOTP verification,
 * it does not use the guessable-secret limiter on the sign-in critical path.
 */

import { api, components } from "@convex/_generated/api";
import schema from "@convex/schema";
import { ConvexError } from "convex/values";
import { expect, test } from "vite-plus/test";

import {
  isSecurityKeyCredential,
  parseBackupState,
  selectAuthenticationCredentials,
  validateBackupEligibility,
  validateCredentialAlgorithm,
} from "../packages/auth/src/server/webauthn";
import { convexTest } from "./convex/setup";

const RP_ORIGIN = "http://localhost:5173";
const DEFAULT_MAX_ATTEMPTS = 10;

test("strict security-key policy rejects platform, hybrid, and backed-up credentials", () => {
  expect(
    isSecurityKeyCredential({
      transports: ["usb", "nfc"],
      deviceType: "singleDevice",
      backedUp: false,
    }),
  ).toBe(true);
  expect(
    isSecurityKeyCredential({
      transports: ["internal"],
      deviceType: "singleDevice",
      backedUp: false,
    }),
  ).toBe(false);
  expect(
    isSecurityKeyCredential({
      transports: ["hybrid"],
      deviceType: "singleDevice",
      backedUp: false,
    }),
  ).toBe(false);
  expect(
    isSecurityKeyCredential({
      transports: ["usb"],
      deviceType: "multiDevice",
      backedUp: true,
    }),
  ).toBe(false);
  // Safari reports no transports for keys Chrome reports as `usb`, so an absent
  // list cannot disqualify a credential the signed flags already vouch for.
  expect(isSecurityKeyCredential({ deviceType: "singleDevice", backedUp: false })).toBe(true);
  expect(
    isSecurityKeyCredential({ transports: [], deviceType: "singleDevice", backedUp: false }),
  ).toBe(true);
  expect(
    isSecurityKeyCredential({
      transports: ["smart-card"],
      deviceType: "singleDevice",
      backedUp: false,
    }),
  ).toBe(true);
});

test("strict security-key policy removes mixed password-manager credentials from sign-in", () => {
  const credentials = [
    { id: "yubikey", transports: ["usb", "nfc"] },
    { id: "proton", transports: ["internal", "hybrid"] },
    { id: "unknown-provider" },
  ];

  expect(selectAuthenticationCredentials(credentials, true)).toEqual([
    credentials[0],
    credentials[2],
  ]);
  expect(selectAuthenticationCredentials(credentials, false)).toEqual(credentials);
});

/** base64url-encode a UTF-8 string with no padding (WebAuthn clientDataJSON). */
function base64url(input: string) {
  const b64 = Buffer.from(input, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function assertionAuthenticatorData(deviceFlags = 0x05): Promise<string> {
  const rpIdHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode("localhost")),
  );
  const bytes = new Uint8Array(37);
  bytes.set(rpIdHash);
  bytes[32] = deviceFlags;
  return Buffer.from(bytes).toString("base64url");
}

async function credentialRateLimitIdentifier(credentialId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credentialId));
  return `webauthn:credential:${Buffer.from(digest).toString("base64url")}`;
}

async function invalidAssertionCode(
  t: ReturnType<typeof convexTest>,
  credentialId: string,
): Promise<string> {
  const options = await t.action(api.auth.signIn, {
    request: { provider: "webauthn", params: { flow: "signIn" } },
  });
  if (options.kind !== "webauthnOptions") throw new Error("expected webauthnOptions");
  const challenge = (options.options as { challenge: string }).challenge;
  const clientDataJSON = base64url(
    JSON.stringify({ type: "webauthn.get", challenge, origin: RP_ORIGIN, crossOrigin: false }),
  );
  const error = await t
    .action(api.auth.signIn, {
      request: {
        provider: "webauthn",
        params: {
          flow: "verify",
          credentialId,
          clientDataJSON,
          signature: "AA",
          authenticatorData: await assertionAuthenticatorData(),
        },
      },
      verifier: options.verifier,
    })
    .then(
      () => null,
      (caught) => caught,
    );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ code: string }>).data.code;
}

test("WebAuthn does not inherit the guessable-secret sign-in limiter", async () => {
  const t = convexTest(schema);
  const credentialId = base64url("rl-credential");

  // Seed a user + a resolvable passkey credential.
  await t.run(async (ctx) => {
    const userId = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "passkey-rl@example.com" },
    })) as string;
    await ctx.runMutation(components.auth.factor.passkey.create, {
      userId: userId as never,
      credentialId,
      publicKey: new ArrayBuffer(32),
      algorithm: -7,
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      createdAt: Date.now(),
    });
  });

  // Exhaust the per-credential sign-in rate limit (token bucket capacity 10).
  const identifier = await credentialRateLimitIdentifier(credentialId);
  await t.run(async (ctx) => {
    for (let i = 0; i < DEFAULT_MAX_ATTEMPTS + 2; i++) {
      await ctx.runMutation(components.auth.limits.signInRecord, {
        identifier,
        maxAttemptsPerHour: DEFAULT_MAX_ATTEMPTS,
      });
    }
  });

  // Issue a real challenge and submit an invalid signature. The unrelated
  // sign-in bucket must not intercept WebAuthn; its protocol checks still run.
  const options = await t.action(api.auth.signIn, {
    request: { provider: "webauthn", params: { flow: "signIn" } },
  });
  expect(options.kind).toBe("webauthnOptions");
  if (options.kind !== "webauthnOptions") throw new Error("expected webauthnOptions");
  const challenge = (options.options as { challenge: string }).challenge;
  const clientDataJSON = base64url(
    JSON.stringify({ type: "webauthn.get", challenge, origin: RP_ORIGIN, crossOrigin: false }),
  );

  const error = await t
    .action(api.auth.signIn, {
      request: {
        provider: "webauthn",
        params: {
          flow: "verify",
          credentialId,
          clientDataJSON,
          signature: "AA",
          authenticatorData: await assertionAuthenticatorData(0x0d),
        },
      },
      verifier: options.verifier,
    })
    .then(
      () => null,
      (e) => e,
    );
  expect(error).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe("PASSKEY_INVALID_SIGNATURE");
});

test("passkey verify against an unknown credential uses the public signature error", async () => {
  const t = convexTest(schema);

  const options = await t.action(api.auth.signIn, {
    request: { provider: "webauthn", params: { flow: "signIn" } },
  });
  if (options.kind !== "webauthnOptions") throw new Error("expected webauthnOptions");
  const challenge = (options.options as { challenge: string }).challenge;
  const clientDataJSON = base64url(
    JSON.stringify({ type: "webauthn.get", challenge, origin: RP_ORIGIN, crossOrigin: false }),
  );

  const error = await t
    .action(api.auth.signIn, {
      request: {
        provider: "webauthn",
        params: {
          flow: "verify",
          credentialId: base64url("does-not-exist"),
          clientDataJSON,
          signature: "AA",
          authenticatorData: await assertionAuthenticatorData(),
        },
      },
      verifier: options.verifier,
    })
    .then(
      () => null,
      (caught) => caught,
    );
  expect(error).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe("PASSKEY_INVALID_SIGNATURE");
});

test("WebAuthn does not reveal whether an invalid assertion names a stored credential", async () => {
  const t = convexTest(schema);
  const knownCredentialId = base64url("known-invalid-signature");
  const knownRsaCredentialId = base64url("known-rsa-invalid-signature");
  await t.run(async (ctx) => {
    const userId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "known-invalid@example.com" },
    });
    await ctx.runMutation(components.auth.factor.passkey.create, {
      userId,
      credentialId: knownCredentialId,
      publicKey: new ArrayBuffer(32),
      algorithm: -7,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      createdAt: Date.now(),
    });
    await ctx.runMutation(components.auth.factor.passkey.create, {
      userId,
      credentialId: knownRsaCredentialId,
      publicKey: new ArrayBuffer(32),
      algorithm: -257,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      createdAt: Date.now(),
    });
  });

  expect(await invalidAssertionCode(t, base64url("unknown-invalid-signature"))).toBe(
    "PASSKEY_INVALID_SIGNATURE",
  );
  expect(await invalidAssertionCode(t, knownCredentialId)).toBe("PASSKEY_INVALID_SIGNATURE");
  expect(await invalidAssertionCode(t, knownRsaCredentialId)).toBe("PASSKEY_INVALID_SIGNATURE");
});

test("WebAuthn rejects cross-origin client data before consuming the challenge", async () => {
  const t = convexTest(schema);
  const options = await t.action(api.auth.signIn, {
    request: { provider: "webauthn", params: { flow: "signIn" } },
  });
  if (options.kind !== "webauthnOptions") throw new Error("expected webauthnOptions");
  const challenge = (options.options as { challenge: string }).challenge;
  const clientDataJSON = base64url(
    JSON.stringify({ type: "webauthn.get", challenge, origin: RP_ORIGIN, crossOrigin: true }),
  );

  const error = await t
    .action(api.auth.signIn, {
      request: {
        provider: "webauthn",
        params: {
          flow: "verify",
          credentialId: "unused",
          clientDataJSON,
          signature: "AA",
          authenticatorData: "AA",
        },
      },
      verifier: options.verifier,
    })
    .then(
      () => null,
      (caught) => caught,
    );
  expect(error).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe("PASSKEY_INVALID_CLIENT_DATA");

  const verifier = await t.run((ctx) =>
    ctx.runQuery(components.auth.token.pkce.get, {
      selector: { id: options.verifier as never },
      now: Date.now(),
    }),
  );
  expect(verifier).not.toBeNull();
});

test("WebAuthn derives backup state from signed authenticator flags", () => {
  const singleDevice = new Uint8Array(33);
  expect(parseBackupState(singleDevice)).toEqual({
    deviceType: "singleDevice",
    backedUp: false,
  });

  const multiDevice = new Uint8Array(33);
  multiDevice[32] = 0x08 | 0x10;
  expect(parseBackupState(multiDevice)).toEqual({
    deviceType: "multiDevice",
    backedUp: true,
  });

  const invalid = new Uint8Array(33);
  invalid[32] = 0x10;
  expect(() => parseBackupState(invalid)).toThrow(ConvexError);
});

test("WebAuthn rejects changed backup eligibility for an existing credential", () => {
  expect(() => validateBackupEligibility("singleDevice", "singleDevice")).not.toThrow();
  expect(() => validateBackupEligibility("singleDevice", "multiDevice")).toThrow(ConvexError);
});

test("WebAuthn rejects a credential algorithm the server did not offer", () => {
  expect(() => validateCredentialAlgorithm(-7, [-7])).not.toThrow();
  expect(() => validateCredentialAlgorithm(-257, [-7])).toThrow(ConvexError);
});
