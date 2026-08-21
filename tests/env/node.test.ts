import { afterEach, expect, test } from "vite-plus/test";

import { envOptionalString, requireAuthKey } from "../../packages/auth/src/server/env";

const KEY_NAMES = ["AUTH_KEYS"] as const;
const ORIGINAL_ENV = Object.fromEntries(KEY_NAMES.map((name) => [name, process.env[name]]));

function clearKeys() {
  for (const name of KEY_NAMES) {
    delete process.env[name];
  }
}

afterEach(() => {
  clearKeys();
  for (const name of KEY_NAMES) {
    const value = ORIGINAL_ENV[name];
    if (value !== undefined) {
      process.env[name] = value;
    }
  }
});

test("AUTH_KEYS exposes purpose-specific key material", () => {
  clearKeys();
  process.env.AUTH_KEYS = JSON.stringify({
    version: 1,
    jwtPrivateKey: "private-key",
    jwks: { keys: [{ kty: "OKP", crv: "Ed25519", x: "public-key" }] },
    secretEncryptionKey: "secret-encryption-key",
    webauthnMaskingKey: "webauthn-masking-key",
  });

  expect(envOptionalString("AUTH_KEYS")).toBe(process.env.AUTH_KEYS);
  expect(requireAuthKey("jwtPrivateKey")).toBe("private-key");
  expect(requireAuthKey("jwks")).toEqual({
    keys: [{ kty: "OKP", crv: "Ed25519", x: "public-key" }],
  });
  expect(requireAuthKey("secretEncryptionKey")).toBe("secret-encryption-key");
  expect(requireAuthKey("webauthnMaskingKey")).toBe("webauthn-masking-key");
});

test("invalid AUTH_KEYS fails closed instead of falling back", () => {
  clearKeys();
  process.env.AUTH_KEYS = '{"version":2}';

  expect(() => requireAuthKey("jwtPrivateKey")).toThrow("unsupported keyring version");
});
