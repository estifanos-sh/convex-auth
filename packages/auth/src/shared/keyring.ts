/** Version of the serialized auth keyring stored in `AUTH_KEYS`. */
export const AUTH_KEYS_VERSION = 1;

/** Cryptographic material stored together in the versioned `AUTH_KEYS` value. */
export type AuthKeyring = {
  version: typeof AUTH_KEYS_VERSION;
  jwtPrivateKey: string;
  jwks: { keys: Array<Record<string, unknown>> };
  secretEncryptionKey: string;
};

/** Error thrown when `AUTH_KEYS` cannot be decoded safely. */
export class AuthKeyringError extends Error {
  constructor(message: string) {
    super(`Invalid environment variable \`AUTH_KEYS\`: ${message}`);
    this.name = "AuthKeyringError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Serialize an auth keyring for storage in a Convex environment variable. */
export function serializeAuthKeyring(keyring: AuthKeyring): string {
  return JSON.stringify(keyring);
}

/** Parse and validate the versioned auth keyring stored in `AUTH_KEYS`. */
export function parseAuthKeyring(value: string): AuthKeyring {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new AuthKeyringError("expected valid JSON");
  }

  if (!isRecord(parsed)) {
    throw new AuthKeyringError("expected a JSON object");
  }
  if (parsed.version !== AUTH_KEYS_VERSION) {
    throw new AuthKeyringError(`unsupported keyring version \`${String(parsed.version)}\``);
  }
  if (typeof parsed.jwtPrivateKey !== "string" || parsed.jwtPrivateKey.length === 0) {
    throw new AuthKeyringError("missing non-empty `jwtPrivateKey`");
  }
  if (!isRecord(parsed.jwks) || !Array.isArray(parsed.jwks.keys) || parsed.jwks.keys.length === 0) {
    throw new AuthKeyringError("missing non-empty `jwks.keys`");
  }
  if (!parsed.jwks.keys.every(isRecord)) {
    throw new AuthKeyringError("expected every entry in `jwks.keys` to be an object");
  }
  if (typeof parsed.secretEncryptionKey !== "string" || parsed.secretEncryptionKey.length === 0) {
    throw new AuthKeyringError("missing non-empty `secretEncryptionKey`");
  }

  return {
    version: AUTH_KEYS_VERSION,
    jwtPrivateKey: parsed.jwtPrivateKey,
    jwks: { keys: parsed.jwks.keys },
    secretEncryptionKey: parsed.secretEncryptionKey,
  };
}
