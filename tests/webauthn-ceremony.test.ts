import { webauthn } from "@estifanos-sh/convex-auth/providers/webauthn";
import { applyCeremonyPolicy } from "@estifanos-sh/convex-auth/server/webauthn";
import { expect, test } from "vite-plus/test";

test("a ceremony without a policy reuses the provider untouched", () => {
  const passkeys = webauthn({ securityKeysOnly: true });

  expect(applyCeremonyPolicy(passkeys, undefined)).toBe(passkeys);
});

test("enabling securityKeysOnly couples attachment and hints on both halves", () => {
  const passkeys = webauthn();
  const narrowed = applyCeremonyPolicy(passkeys, { securityKeysOnly: true });

  expect(narrowed.options.securityKeysOnly).toBe(true);
  expect(narrowed.options.registration.authenticatorAttachment).toBe("cross-platform");
  expect(narrowed.options.registration.hints).toEqual(["security-key"]);
  expect(narrowed.options.authentication.hints).toEqual(["security-key"]);
});

test("disabling securityKeysOnly clears every field it had set", () => {
  // A half-applied release is the dangerous direction: a ceremony that widens
  // the policy but keeps security-key hints silently refuses the platform
  // authenticator the caller just asked for.
  const passkeys = webauthn({ securityKeysOnly: true });
  const widened = applyCeremonyPolicy(passkeys, { securityKeysOnly: false });

  expect(widened.options.securityKeysOnly).toBe(false);
  expect(widened.options.registration.authenticatorAttachment).toBeUndefined();
  expect(widened.options.registration.hints).toBeUndefined();
  expect(widened.options.authentication.hints).toBeUndefined();
});

test("explicit fields win over the securityKeysOnly shorthand", () => {
  const passkeys = webauthn();
  const tuned = applyCeremonyPolicy(passkeys, {
    securityKeysOnly: true,
    registration: { residentKey: "required", hints: ["hybrid"] },
    authentication: { userVerification: "required" },
  });

  expect(tuned.options.registration.residentKey).toBe("required");
  expect(tuned.options.registration.hints).toEqual(["hybrid"]);
  expect(tuned.options.authentication.userVerification).toBe("required");
  // Still coupled where the caller did not override.
  expect(tuned.options.registration.authenticatorAttachment).toBe("cross-platform");
});

test("applying a policy never mutates the shared provider", () => {
  const passkeys = webauthn({ securityKeysOnly: true });
  const before = JSON.stringify(passkeys.options);

  applyCeremonyPolicy(passkeys, {
    securityKeysOnly: false,
    registration: { residentKey: "required" },
  });

  expect(JSON.stringify(passkeys.options)).toBe(before);
});

test("a policy leaves unrelated provider fields in place", () => {
  const passkeys = webauthn({ rpId: "example.com", challengeExpirationMs: 1_000 });
  const narrowed = applyCeremonyPolicy(passkeys, { securityKeysOnly: true });

  expect(narrowed.options.rpId).toBe("example.com");
  expect(narrowed.options.challengeExpirationMs).toBe(1_000);
  expect(narrowed.id).toBe(passkeys.id);
});

test("signIn carries the ceremony context and stays absent when unset", () => {
  const passkeys = webauthn();

  expect(passkeys.signIn().context).toBeUndefined();
  expect(passkeys.signIn({ email: "member@example.com" }).context).toEqual({
    email: "member@example.com",
  });
});

test("rotate carries a per-call policy", () => {
  const passkeys = webauthn({ securityKeysOnly: true });

  const operation = passkeys.rotate({ policy: { securityKeysOnly: false } });

  expect(operation.operation).toBe("rotate");
  expect(operation.context?.policy).toEqual({ securityKeysOnly: false });
});
