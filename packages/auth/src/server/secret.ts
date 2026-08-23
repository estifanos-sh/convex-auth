import { sha256 as rawSha256 } from "@oslojs/crypto/sha2";
import { decodeBase64urlIgnorePadding, encodeBase64urlNoPadding } from "@oslojs/encoding";

import type { EncryptedSecret } from "../shared/brand";
import { ErrorCode } from "../shared/codes";
import { convexError } from "./errors";

import { requireAuthKey } from "./env";

const SECRET_IV_LENGTH = 12;

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function getSecretCryptoKey() {
  const material = requireAuthKey("secretEncryptionKey");
  const rawKey = rawSha256(new TextEncoder().encode(material));
  return await crypto.subtle.importKey("raw", toArrayBuffer(rawKey), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** @internal */
export async function encryptSecret(value: string): Promise<EncryptedSecret> {
  const key = await getSecretCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(SECRET_IV_LENGTH));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(new TextEncoder().encode(value)),
  );
  return `${encodeBase64urlNoPadding(iv)}.${encodeBase64urlNoPadding(new Uint8Array(encrypted))}` as EncryptedSecret;
}

/** @internal */
export async function decryptSecret(ciphertext: string) {
  const parts = ciphertext.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw convexError(ErrorCode.INVALID_PARAMETERS, "Stored group connection secret is malformed.");
  }
  const [ivEncoded, payloadEncoded] = parts;
  const key = await getSecretCryptoKey();
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(decodeBase64urlIgnorePadding(ivEncoded)),
    },
    key,
    toArrayBuffer(decodeBase64urlIgnorePadding(payloadEncoded)),
  );
  return new TextDecoder().decode(decrypted);
}
