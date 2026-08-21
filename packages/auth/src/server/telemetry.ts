/**
 * Auth telemetry helpers for OpenTelemetry span enrichment.
 *
 * @module
 * @internal
 */

import type { Attributes } from "@opentelemetry/api";

import { authDb } from "./db";
import { envOptionalString, readConfigSync } from "./env";
import type {
  AuthTelemetryIdentityField,
  ConvexAuthMaterializedConfig,
  CrossComponentUserDoc,
  MutationCtx,
} from "./types";

type AuthIdentityArgs = {
  userId: string;
  sessionId: string;
  refreshTokenId?: string;
};

function tokenIdentifierForUser(userId: string) {
  const issuer = readConfigSync(envOptionalString("CONVEX_SITE_URL"));
  return typeof issuer === "string" && issuer.length > 0 ? `${userId}${issuer}` : userId;
}

const AUTH_IDENTITY_ATTRIBUTE_KEYS = {
  userId: "auth.user.id",
  sessionId: "auth.session.id",
  refreshTokenId: "auth.refresh_token.id",
  email: "auth.user.email",
  tokenIdentifier: "auth.token_identifier",
} as const satisfies Record<AuthTelemetryIdentityField, string>;

type AuthIdentityValues = {
  userId?: string;
  sessionId?: string;
  refreshTokenId?: string;
  email?: string;
  tokenIdentifier?: string;
};

function projectIdentityValue(
  config: ConvexAuthMaterializedConfig,
  field: AuthTelemetryIdentityField,
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const mode = config.telemetry?.includeIdentity ?? "none";
  if (mode === "none") {
    return undefined;
  }

  if (mode === "hashed") {
    return config.telemetry?.hashIdentity?.(value, field);
  }

  return value;
}

async function buildAuthIdentityAttributes(
  ctx: MutationCtx,
  config: ConvexAuthMaterializedConfig,
  args: AuthIdentityArgs,
): Promise<Attributes> {
  const fields = config.telemetry?.identityFields ?? {};
  const mode = config.telemetry?.includeIdentity ?? "none";
  if (mode === "none") {
    return {};
  }

  let email: string | undefined;
  if (fields.email) {
    const user = (await authDb(ctx, config).users.get({
      id: args.userId,
    })) as CrossComponentUserDoc | null;
    if (typeof user?.email === "string") {
      email = user.email;
    }
  }

  return buildKnownAuthIdentityAttributes(config, args, email);
}

function buildKnownAuthIdentityAttributes(
  config: ConvexAuthMaterializedConfig,
  args: AuthIdentityArgs,
  email?: string,
): Attributes {
  const fields = config.telemetry?.identityFields ?? {};
  const mode = config.telemetry?.includeIdentity ?? "none";
  if (mode === "none") return {};

  const values: AuthIdentityValues = {
    userId: args.userId,
    sessionId: args.sessionId,
    tokenIdentifier: tokenIdentifierForUser(args.userId),
  };
  if (args.refreshTokenId !== undefined) values.refreshTokenId = args.refreshTokenId;
  if (email !== undefined) values.email = email;

  const attributes: Attributes = {};
  for (const field of Object.keys(fields) as AuthTelemetryIdentityField[]) {
    if (!fields[field]) {
      continue;
    }
    const projected = projectIdentityValue(config, field, values[field]);
    if (projected !== undefined) {
      attributes[AUTH_IDENTITY_ATTRIBUTE_KEYS[field]] = projected;
    }
  }

  if (Object.keys(attributes).length > 0) {
    attributes["auth.identity.mode"] = mode;
  }

  return attributes;
}

/** Build refresh span attributes from the user returned by token rotation. @internal */
export function buildKnownRefreshIdentityAttributes(
  config: ConvexAuthMaterializedConfig,
  args: Required<Pick<AuthIdentityArgs, "userId" | "sessionId" | "refreshTokenId">>,
  email?: string,
): Attributes {
  return buildKnownAuthIdentityAttributes(config, args, email);
}

/** @internal */
export async function buildRefreshIdentityAttributes(
  ctx: MutationCtx,
  config: ConvexAuthMaterializedConfig,
  args: Required<Pick<AuthIdentityArgs, "userId" | "sessionId" | "refreshTokenId">>,
): Promise<Attributes> {
  return await buildAuthIdentityAttributes(ctx, config, args);
}

/** @internal */
export async function buildSignInIdentityAttributes(
  ctx: MutationCtx,
  config: ConvexAuthMaterializedConfig,
  args: Pick<AuthIdentityArgs, "userId" | "sessionId">,
): Promise<Attributes> {
  return await buildAuthIdentityAttributes(ctx, config, args);
}

/** Build sign-in span attributes from a user already loaded by the session transaction. @internal */
export function buildKnownSignInIdentityAttributes(
  config: ConvexAuthMaterializedConfig,
  args: Pick<AuthIdentityArgs, "userId" | "sessionId">,
  email?: string,
): Attributes {
  return buildKnownAuthIdentityAttributes(config, args, email);
}

/** @internal */
export async function buildSignOutIdentityAttributes(
  ctx: MutationCtx,
  config: ConvexAuthMaterializedConfig,
  args: Pick<AuthIdentityArgs, "userId" | "sessionId">,
): Promise<Attributes> {
  return await buildAuthIdentityAttributes(ctx, config, args);
}
