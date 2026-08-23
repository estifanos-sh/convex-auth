import { ErrorCode } from "../shared/codes";
import { convexError } from "./errors";
import { AuthKeyringError, parseAuthKeyring, type AuthKeyring } from "../shared/keyring";

function readRawEnv(name: string): string | undefined {
  const value = typeof process === "undefined" ? undefined : process.env?.[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Env vars whose absence points the user at the setup wizard rather than a bare miss. */
const SETUP_WIZARD_ENV = new Set(["AUTH_KEYS"]);

function missingEnvMessage(name: string) {
  return SETUP_WIZARD_ENV.has(name)
    ? `Missing environment variable \`${name}\`. Run the convex-auth setup wizard to generate and configure auth keys.`
    : `Missing environment variable \`${name}\``;
}

/** @internal */
export const readConfigSync = <A>(value: A) => value;

/** @internal */
export const envString = (name: string) => {
  const value = readRawEnv(name);
  if (value === undefined) {
    throw new Error(missingEnvMessage(name));
  }
  return value;
};

/** @internal */
export const envOptionalString = (name: string) => readRawEnv(name);

/** @internal */
export const envOptionalNumber = (name: string) => {
  const value = readRawEnv(name);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric environment variable \`${name}\``);
  }
  return parsed;
};

/** @internal */
export const envBoolean = (name: string) => {
  const value = readRawEnv(name);
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`Invalid boolean environment variable \`${name}\``);
};

type AuthKeyPurpose = Exclude<keyof AuthKeyring, "version">;

/** @internal */
export function requireAuthKey<Purpose extends AuthKeyPurpose>(
  purpose: Purpose,
): AuthKeyring[Purpose] {
  try {
    const value = readRawEnv("AUTH_KEYS");
    if (value === undefined) {
      throw new Error(missingEnvMessage("AUTH_KEYS"));
    }
    return parseAuthKeyring(value)[purpose];
  } catch (error) {
    throw convexError(
      ErrorCode.MISSING_ENV_VAR,
      error instanceof AuthKeyringError ? error.message : missingEnvMessage("AUTH_KEYS"),
    );
  }
}

/** @internal */
export function requireEnv(name: string) {
  try {
    return readConfigSync(envString(name));
  } catch (error) {
    throw convexError(
      ErrorCode.MISSING_ENV_VAR,
      error instanceof AuthKeyringError ? error.message : missingEnvMessage(name),
    );
  }
}
