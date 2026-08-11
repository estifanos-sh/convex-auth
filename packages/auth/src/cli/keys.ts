import { randomBytes } from "node:crypto";

import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

import {
  AUTH_KEYS_VERSION,
  parseAuthKeyring,
  serializeAuthKeyring,
  type AuthKeyring,
} from "../shared/keyring";

/** Legacy key variables accepted when bundling an existing deployment. */
export type LegacyAuthKeys = {
  JWT_PRIVATE_KEY: string;
  JWKS: string;
  AUTH_SECRET_ENCRYPTION_KEY: string;
};

/** Bundle existing legacy key variables without rotating their cryptographic material. */
export function bundleLegacyKeys(keys: LegacyAuthKeys): string {
  let jwks: unknown;
  try {
    jwks = JSON.parse(keys.JWKS);
  } catch {
    throw new Error("Cannot migrate auth keys because the existing `JWKS` value is invalid JSON.");
  }

  const candidate = JSON.stringify({
    version: AUTH_KEYS_VERSION,
    jwtPrivateKey: keys.JWT_PRIVATE_KEY,
    jwks,
    secretEncryptionKey: keys.AUTH_SECRET_ENCRYPTION_KEY,
    webauthnMaskingKey: randomBytes(32).toString("base64url"),
  });
  return serializeAuthKeyring(parseAuthKeyring(candidate));
}

/**
 * Generate a fresh versioned auth keyring.
 *
 * Used by the Convex Auth setup wizard to provision required environment
 * material in one `AUTH_KEYS` value on a target Convex deployment. Signing and
 * at-rest encryption still use independent cryptographic keys.
 *
 * @returns A serialized `AUTH_KEYS` value.
 * @internal
 */
export async function generateKeys() {
  try {
    const keys = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
    const privateKey = await exportPKCS8(keys.privateKey);
    const publicKey = await exportJWK(keys.publicKey);
    const keyring: AuthKeyring = {
      version: AUTH_KEYS_VERSION,
      jwtPrivateKey: privateKey.trimEnd(),
      jwks: { keys: [{ use: "sig", ...publicKey }] },
      secretEncryptionKey: randomBytes(32).toString("base64url"),
      webauthnMaskingKey: randomBytes(32).toString("base64url"),
    };
    return {
      AUTH_KEYS: serializeAuthKeyring(keyring),
    };
  } catch (error) {
    console.error(
      `Could not generate private and public key, are you running this command using Node.js?\n ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
