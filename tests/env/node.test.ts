import { afterEach, expect, test } from "vite-plus/test";

import { envOptionalString, requireEnv } from "../../packages/auth/src/server/env";

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

test("AUTH_KEYS resolves the legacy runtime key names", () => {
  clearKeys();
  process.env.AUTH_KEYS = JSON.stringify({
    version: 1,
    jwtPrivateKey: "private-key",
    jwks: { keys: [{ kty: "OKP", crv: "Ed25519", x: "public-key" }] },
    secretEncryptionKey: "secret-encryption-key",
  });

  expect(envOptionalString("JWT_PRIVATE_KEY")).toBe("private-key");
  expect(JSON.parse(requireEnv("JWKS"))).toEqual({
    keys: [{ kty: "OKP", crv: "Ed25519", x: "public-key" }],
  });
  expect(requireEnv("AUTH_SECRET_ENCRYPTION_KEY")).toBe("secret-encryption-key");
});

test("AUTH_KEYS takes precedence over legacy key variables", () => {
  clearKeys();
  process.env.AUTH_KEYS = JSON.stringify({
    version: 1,
    jwtPrivateKey: "keyring-private-key",
    jwks: { keys: [{ kty: "keyring" }] },
    secretEncryptionKey: "keyring-encryption-key",
  });
  process.env.JWT_PRIVATE_KEY = "legacy-private-key";
  process.env.JWKS = JSON.stringify({ keys: [{ kty: "legacy" }] });
  process.env.AUTH_SECRET_ENCRYPTION_KEY = "legacy-encryption-key";

  expect(requireEnv("JWT_PRIVATE_KEY")).toBe("keyring-private-key");
  expect(JSON.parse(requireEnv("JWKS"))).toEqual({ keys: [{ kty: "keyring" }] });
  expect(requireEnv("AUTH_SECRET_ENCRYPTION_KEY")).toBe("keyring-encryption-key");
});

test("legacy key variables remain supported without AUTH_KEYS", () => {
  clearKeys();
  process.env.JWT_PRIVATE_KEY = "legacy-private-key";
  process.env.JWKS = "legacy-jwks";
  process.env.AUTH_SECRET_ENCRYPTION_KEY = "legacy-encryption-key";

  expect(requireEnv("JWT_PRIVATE_KEY")).toBe("legacy-private-key");
  expect(requireEnv("JWKS")).toBe("legacy-jwks");
  expect(requireEnv("AUTH_SECRET_ENCRYPTION_KEY")).toBe("legacy-encryption-key");
});

test("invalid AUTH_KEYS fails closed instead of falling back", () => {
  clearKeys();
  process.env.AUTH_KEYS = '{"version":2}';
  process.env.JWT_PRIVATE_KEY = "legacy-private-key";

  expect(() => requireEnv("JWT_PRIVATE_KEY")).toThrow("unsupported keyring version");
});
