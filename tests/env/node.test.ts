import { afterEach, expect, test } from "vite-plus/test";

import { envOptionalString, requireAuthKey } from "../../packages/auth/src/server/env";

const KEY_NAMES = ["AUTH_KEYS", "JWT_PRIVATE_KEY", "JWKS", "AUTH_SECRET_ENCRYPTION_KEY"] as const;
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

test("AUTH_KEYS is the only runtime source for auth key material", () => {
  clearKeys();
  process.env.AUTH_KEYS = JSON.stringify({
    version: 1,
    jwtPrivateKey: "keyring-private-key",
    jwks: { keys: [{ kty: "keyring" }] },
    secretEncryptionKey: "keyring-encryption-key",
    webauthnMaskingKey: "keyring-webauthn-masking-key",
  });
  process.env.JWT_PRIVATE_KEY = "legacy-private-key";
  process.env.JWKS = JSON.stringify({ keys: [{ kty: "legacy" }] });
  process.env.AUTH_SECRET_ENCRYPTION_KEY = "legacy-encryption-key";

  expect(requireAuthKey("jwtPrivateKey")).toBe("keyring-private-key");
  expect(requireAuthKey("jwks")).toEqual({ keys: [{ kty: "keyring" }] });
  expect(requireAuthKey("secretEncryptionKey")).toBe("keyring-encryption-key");
  expect(requireAuthKey("webauthnMaskingKey")).toBe("keyring-webauthn-masking-key");
});

test("legacy key variables are ignored without AUTH_KEYS", () => {
  clearKeys();
  process.env.JWT_PRIVATE_KEY = "legacy-private-key";
  process.env.JWKS = "legacy-jwks";
  process.env.AUTH_SECRET_ENCRYPTION_KEY = "legacy-encryption-key";

  expect(() => requireAuthKey("jwtPrivateKey")).toThrow("AUTH_KEYS");
  expect(() => requireAuthKey("jwks")).toThrow("AUTH_KEYS");
  expect(() => requireAuthKey("secretEncryptionKey")).toThrow("AUTH_KEYS");
  expect(() => requireAuthKey("webauthnMaskingKey")).toThrow("AUTH_KEYS");
});

test("invalid AUTH_KEYS fails closed instead of falling back", () => {
  clearKeys();
  process.env.AUTH_KEYS = '{"version":2}';
  process.env.JWT_PRIVATE_KEY = "legacy-private-key";

  expect(() => requireAuthKey("jwtPrivateKey")).toThrow("unsupported keyring version");
});
