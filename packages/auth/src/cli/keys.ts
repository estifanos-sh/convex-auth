import { randomBytes } from "node:crypto";

import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

import { AUTH_KEYS_VERSION, serializeAuthKeyring, type AuthKeyring } from "../shared/keyring";

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
