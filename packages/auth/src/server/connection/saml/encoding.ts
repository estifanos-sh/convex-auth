import { inflateSync, deflateSync } from "fflate";
import { decodeBase64, encodeBase64 } from "@oslojs/encoding";

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

function toByteArray(input: string | number[] | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (Array.isArray(input)) {
    return Uint8Array.from(input);
  }
  return utf8Encoder.encode(input);
}

function base64ToBytes(base64Message: string): Uint8Array {
  return decodeBase64(base64Message.replace(/\s+/g, ""));
}

/** Decode a string or `Uint8Array` to a UTF-8 string. */
export function toUtf8String(input: string | Uint8Array): string {
  if (typeof input === "string") {
    return input;
  }
  return utf8Decoder.decode(input);
}

/** Whether `input` is a string. */
export function isString(input: unknown): input is string {
  return typeof input === "string";
}

/** Whether `input` is an array with at least one element. */
export function isNonEmptyArray(a: unknown): boolean {
  return Array.isArray(a) && a.length > 0;
}

/** Wrap a value as an array, treating `undefined` as the empty array. */
export function castArrayOpt<T>(a?: T | T[]): T[] {
  if (a === undefined) return [];
  return Array.isArray(a) ? a : [a];
}

/** Recursively flatten a nested array to a single level (lodash.flattenDeep). */
export function flattenDeep(input: unknown): unknown[] {
  if (!Array.isArray(input)) return [input];
  const out: unknown[] = [];
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) {
      for (const el of x) walk(el);
    } else {
      out.push(x);
    }
  };
  walk(input);
  return out;
}

/**
 * Read a string at a dotted `path`, returning `defaultValue` when a segment is
 * missing or the resolved value is not a string.
 */
export function getString(obj: unknown, path: string, defaultValue: string): string;
export function getString(obj: unknown, path: string, defaultValue: null): string | null;
export function getString(obj: unknown, path: string, defaultValue: string | null): string | null {
  let current: unknown = obj;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return defaultValue;
    }
    current = Object.getOwnPropertyDescriptor(current, segment)?.value;
  }
  return typeof current === "string" ? current : defaultValue;
}

/** Base64-encode a string, byte array, or `Uint8Array`. */
export function base64Encode(message: string | number[] | Uint8Array): string {
  return encodeBase64(toByteArray(message));
}

/** Base64-decode to a string, or to raw bytes when `isBytes` is set. */
export function base64Decode(base64Message: string, isBytes?: boolean): string | Uint8Array {
  const bytes = base64ToBytes(base64Message);
  return isBytes ? bytes : utf8Decoder.decode(bytes);
}

/** DEFLATE-compress a string, returning the raw bytes as a number array. */
export function deflateString(message: string): number[] {
  const input = utf8Encoder.encode(message);
  return Array.from(deflateSync(input));
}

/** INFLATE-decompress a base64-encoded DEFLATE payload back to its string. */
export function inflateString(compressedString: string): string {
  const inputBuffer = base64ToBytes(compressedString);
  return utf8Decoder.decode(inflateSync(inputBuffer));
}

/** Strip the PEM armor, line breaks, and whitespace from a certificate string. */
export function normalizeCerString(certString: string | Uint8Array): string {
  return toUtf8String(certString)
    .replace(/\n/g, "")
    .replace(/\r/g, "")
    .replace("-----BEGIN CERTIFICATE-----", "")
    .replace("-----END CERTIFICATE-----", "")
    .replace(/ /g, "")
    .replace(/\t/g, "");
}

/**
 * Return the private key as-is, rejecting passphrase-protected keys this runtime
 * cannot decrypt. The third argument is accepted for call-site compatibility and
 * does not affect the result.
 */
export function readPrivateKey(
  keyString: string | Uint8Array,
  passphrase: string | undefined,
  _isOutputString?: boolean,
): string | Uint8Array {
  if (!isString(passphrase)) {
    return keyString;
  }
  throw new Error(
    "Passphrase-protected private keys are not supported in this runtime. Provide an unencrypted key.",
  );
}
