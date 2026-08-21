import { sha1 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { decodeBase64, encodeBase64 } from "@oslojs/encoding";

const utf8Encoder = new TextEncoder();

/** Base64-encoded SHA-1 digest of a UTF-8 string. */
export function sha1Base64(text: string): string {
  const bytes = utf8Encoder.encode(text);
  return encodeBase64(sha1(bytes));
}

/** Base64-encoded SHA-256 digest of a UTF-8 string. */
export function sha256Base64(text: string): string {
  const bytes = utf8Encoder.encode(text);
  return encodeBase64(sha256(bytes));
}

/** Decode a PEM block to its raw DER bytes, stripping the armor and whitespace. */
export function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return decodeBase64(b64);
}

function derToPem(der: Uint8Array, label: string): string {
  const b64 = encodeBase64(der);
  const lines = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

type DerLength = { length: number; consumed: number };

type DerElement = { value: Uint8Array; end: number };

function readDerLength(buf: Uint8Array, pos: number): DerLength {
  const first = buf[pos];
  if (first < 0x80) return { length: first, consumed: 1 };
  const n = first & 0x7f;
  let length = 0;
  for (let i = 0; i < n; i++) length = (length << 8) | buf[pos + 1 + i];
  return { length, consumed: 1 + n };
}

function readDerElement(buf: Uint8Array, pos: number): DerElement {
  const { length, consumed } = readDerLength(buf, pos + 1);
  const valueStart = pos + 1 + consumed;
  return { value: buf.subarray(valueStart, valueStart + length), end: valueStart + length };
}

function derEncodeLength(len: number): Uint8Array {
  if (len < 0x80) return new Uint8Array([len]);
  if (len < 0x100) return new Uint8Array([0x81, len]);
  return new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

/**
 * Walk a DER-encoded X.509 certificate's TBSCertificate (Certificate SEQUENCE →
 * first element), skipping optional version, serialNumber, signature
 * AlgorithmIdentifier, issuer, validity, and subject to reach and return the
 * SubjectPublicKeyInfo bytes.
 */
function extractSpkiFromCert(certPem: string): Uint8Array {
  const certDer = pemToDer(certPem);
  const cert = readDerElement(certDer, 0);
  const tbs = readDerElement(cert.value, 0);
  const tbsContent = tbs.value;

  let pos = 0;
  if (tbsContent[pos] === 0xa0) pos = readDerElement(tbsContent, pos).end;
  pos = readDerElement(tbsContent, pos).end;
  pos = readDerElement(tbsContent, pos).end;
  pos = readDerElement(tbsContent, pos).end;
  pos = readDerElement(tbsContent, pos).end;
  pos = readDerElement(tbsContent, pos).end;
  const spki = readDerElement(tbsContent, pos);
  return tbsContent.subarray(pos, spki.end);
}

const RSA_ALG_ID = new Uint8Array([
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
]);

/**
 * Wrap a PKCS#1 `RSA PRIVATE KEY` in a PKCS#8 PrivateKeyInfo structure.
 *
 * Needed because WebCrypto only imports PKCS#8; a key in PKCS#1 form must be
 * converted before {@link crypto.subtle.importKey}.
 *
 * @returns the PKCS#8 DER bytes.
 */
export function pkcs1ToPkcs8(pkcs1Pem: string): Uint8Array {
  const pkcs1 = pemToDer(pkcs1Pem);
  const octetLen = derEncodeLength(pkcs1.length);
  const octetString = concatBytes(new Uint8Array([0x04]), octetLen, pkcs1);
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const inner = concatBytes(version, RSA_ALG_ID, octetString);
  const outerLen = derEncodeLength(inner.length);
  return concatBytes(new Uint8Array([0x30]), outerLen, inner);
}

function normalizeCertPem(input: string): string {
  if (input.includes("BEGIN CERTIFICATE")) return input;
  return `-----BEGIN CERTIFICATE-----\n${input}\n-----END CERTIFICATE-----`;
}

async function importSpkiKey(spki: Uint8Array, hash: "SHA-1" | "SHA-256"): Promise<CryptoKey> {
  const copy = new Uint8Array(spki).buffer as ArrayBuffer;
  return crypto.subtle.importKey("spki", copy, { name: "RSASSA-PKCS1-v1_5", hash }, false, [
    "verify",
  ]);
}

async function importPublicKeyFromCert(
  certPem: string,
  hash: "SHA-1" | "SHA-256",
): Promise<CryptoKey> {
  const pem = normalizeCertPem(certPem);
  const spki = extractSpkiFromCert(pem);
  return importSpkiKey(spki, hash);
}

async function importPrivateKey(
  privateKeyPem: string,
  hash: "SHA-1" | "SHA-256",
  usages: KeyUsage[],
  algo: string = "RSASSA-PKCS1-v1_5",
): Promise<CryptoKey> {
  let pkcs8: Uint8Array;
  if (privateKeyPem.includes("BEGIN RSA PRIVATE KEY")) {
    pkcs8 = pkcs1ToPkcs8(privateKeyPem);
  } else {
    pkcs8 = pemToDer(privateKeyPem);
  }
  const copy = new Uint8Array(pkcs8).buffer as ArrayBuffer;
  return crypto.subtle.importKey("pkcs8", copy, { name: algo, hash }, false, usages);
}

/** Sign `data` with an RSASSA-PKCS1-v1_5 private key, returning a base64 signature. */
export async function rsaSign(
  privateKeyPem: string,
  data: string,
  hash: "SHA-1" | "SHA-256",
): Promise<string> {
  const key = await importPrivateKey(privateKeyPem, hash, ["sign"]);
  const bytes = utf8Encoder.encode(data);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, bytes);
  return encodeBase64(new Uint8Array(sig));
}

/**
 * Verify an RSASSA-PKCS1-v1_5 signature.
 *
 * @param certOrPubKeyPem an `X509 CERTIFICATE` or `PUBLIC KEY` PEM.
 */
export async function rsaVerify(
  certOrPubKeyPem: string,
  data: string,
  signatureBase64: string,
  hash: "SHA-1" | "SHA-256",
): Promise<boolean> {
  let key: CryptoKey;
  if (certOrPubKeyPem.includes("BEGIN CERTIFICATE")) {
    key = await importPublicKeyFromCert(certOrPubKeyPem, hash);
  } else {
    const spki = pemToDer(certOrPubKeyPem);
    key = await importSpkiKey(spki, hash);
  }
  const sigBytes = new Uint8Array(decodeBase64(signatureBase64.replace(/\s+/g, "")))
    .buffer as ArrayBuffer;
  const dataBytes = utf8Encoder.encode(data);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sigBytes, dataBytes);
}

/** Extract the SubjectPublicKeyInfo from an X.509 cert as a `PUBLIC KEY` PEM. */
export function getPublicKeyPemFromCert(certPem: string): string {
  const pem = normalizeCertPem(certPem);
  const spki = extractSpkiFromCert(pem);
  return derToPem(spki, "PUBLIC KEY");
}
