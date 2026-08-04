import type { UserIdentity } from "convex/server";

import type { ComponentReadCtx } from "../component/context";
import { oauthScopesFromIdentity, userIdFromIdentity } from "../identity/claims";

type MaybeIdentityCtx = {
  auth?: { getUserIdentity?: () => Promise<UserIdentity | null> };
};

export type OAuthCaller = { userId: string; scopes: string[] };

/** Resolve the scoped OAuth caller carried by the current Convex identity. */
export async function resolveOAuthCaller(
  ctx: ComponentReadCtx & MaybeIdentityCtx,
): Promise<OAuthCaller | null> {
  if (typeof ctx.auth?.getUserIdentity !== "function") return null;
  let identity: UserIdentity | null;
  try {
    identity = await ctx.auth.getUserIdentity();
  } catch {
    return null;
  }
  if (identity === null) return null;
  const scopes = oauthScopesFromIdentity(identity);
  if (scopes === null) return null;
  return { userId: userIdFromIdentity(identity), scopes };
}

/** Cap a user's resolved grants to the scopes delegated to their OAuth token. */
export function capGrantsForCaller(
  caller: OAuthCaller | null,
  inspectedUserId: string,
  grants: string[],
): string[] {
  if (caller === null || caller.userId !== inspectedUserId) return grants;
  return grants.filter((grant) => caller.scopes.includes(grant));
}
