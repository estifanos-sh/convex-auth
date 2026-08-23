import type { UserIdentity } from "convex/server";
import type { GenericId } from "convex/values";

import { ErrorCode } from "../../shared/codes";
import { convexError } from "../errors";

/** @internal */
export function userIdFromIdentitySubject(subject: string): string {
  if (typeof subject !== "string" || subject.length === 0) {
    throw convexError(ErrorCode.INTERNAL_ERROR, "Authenticated identity subject is malformed.");
  }
  return subject;
}

/** @internal */
export function userIdFromIdentity(identity: UserIdentity): GenericId<"User"> {
  return userIdFromIdentitySubject(identity.subject) as GenericId<"User">;
}

/** @internal */
export function sessionIdFromIdentity(identity: UserIdentity): GenericId<"Session"> {
  const sessionId = identity.sid;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw convexError(
      ErrorCode.INTERNAL_ERROR,
      "Authenticated identity is missing a session id claim.",
    );
  }
  return sessionId as GenericId<"Session">;
}

/**
 * Read the OAuth access-token scopes carried by an `at+jwt` identity, or `null`
 * for a session identity. An OAuth access token carries a `client_id` claim (and
 * a space-delimited `scope`); a session token does not. Used to cap an OAuth
 * caller's effective grants to the token's granted scopes, so a scoped token
 * cannot exceed its scope even on a direct Convex call.
 *
 * @internal
 */
export function oauthScopesFromIdentity(identity: UserIdentity): string[] | null {
  const clientId = identity.client_id;
  if (typeof clientId !== "string" || clientId.length === 0) {
    return null;
  }
  const scope = identity.scope;
  return typeof scope === "string" && scope.length > 0 ? scope.split(" ") : [];
}

/** @internal */
export async function getUserIdentityOrNull(ctx: {
  auth: { getUserIdentity: () => Promise<UserIdentity | null> };
}) {
  return await ctx.auth.getUserIdentity();
}

/** @internal */
export async function getAuthenticatedUserIdOrNull(ctx: {
  auth: { getUserIdentity: () => Promise<UserIdentity | null> };
}) {
  const identity = await getUserIdentityOrNull(ctx);
  return identity === null ? null : userIdFromIdentity(identity);
}

/** @internal */
export async function getAuthenticatedSessionIdOrNull(ctx: {
  auth: { getUserIdentity: () => Promise<UserIdentity | null> };
}) {
  const identity = await getUserIdentityOrNull(ctx);
  return identity === null ? null : sessionIdFromIdentity(identity);
}
