import type { EnvFromDefinition } from "convex/server";
import { ConvexError, v } from "convex/values";

import { ErrorCode } from "../shared/codes";
import { AuthKeyringError, parseAuthKeyring, type AuthKeyring } from "../shared/keyring";

const vOptionalBooleanString = v.optional(v.union(v.literal("true"), v.literal("false")));

/**
 * Convex app environment variables used by Convex Auth.
 *
 * Pass this to `defineApp({ env: authEnv })` to get Convex deployment-time
 * validation and generated `env` typing in the parent app.
 */
export const authEnv = {
  ANDROID_APP_LINKS: v.optional(v.string()),
  APP_URL: v.optional(v.string()),
  AUTH_KEYS: v.optional(v.string()),
  AUTH_LOG_LEVEL: v.optional(
    v.union(v.literal("DEBUG"), v.literal("INFO"), v.literal("WARN"), v.literal("ERROR")),
  ),
  AUTH_LOG_SECRETS: vOptionalBooleanString,
  CHANGE_PASSWORD_URL: v.optional(v.string()),
  CONVEX_SITE_URL: v.optional(v.string()),
  IOS_APP_IDS: v.optional(v.string()),
  IOS_APPLINK_PATHS: v.optional(v.string()),
  SECURITY_CONTACT: v.optional(v.string()),
  SECURITY_TXT_EXPIRES_DAYS: v.optional(v.string()),
} as const;

/** Inferred type of the validated auth environment from {@link authEnv}. */
export type AuthEnv = EnvFromDefinition<typeof authEnv>;

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
    throw new ConvexError({
      code: ErrorCode.MISSING_ENV_VAR,
      message: error instanceof AuthKeyringError ? error.message : missingEnvMessage("AUTH_KEYS"),
    });
  }
}

/** @internal */
export function requireEnv(name: string) {
  try {
    return readConfigSync(envString(name));
  } catch (error) {
    throw new ConvexError({
      code: ErrorCode.MISSING_ENV_VAR,
      message: error instanceof AuthKeyringError ? error.message : missingEnvMessage(name),
    });
  }
}
