/**
 * Lightweight auth context entry point for `@estifanos-sh/convex-auth/core`.
 *
 * Provides auth context resolution, user/session/member/group lookups,
 * and authorization helpers without pulling in provider implementations,
 * OAuth, crypto, or sign-in logic.
 *
 * @module
 */

import "../server/identity/convex";

import { createAuthContextFacade } from "../server/facade";
import type {
  AuthConfig,
  AuthContext,
  AuthContextConfig,
  AuthContextFacade,
  AuthLike,
  OptionalAuthContext,
  UserDoc,
} from "../server/facade";
import { configDefaults } from "../server/config";
import { createCoreDomains } from "../server/core";
import {
  callInvalidateSessions,
  callCreateAccountFromCredentials,
  callRetrieveAccountWithCredentials,
  callModifyAccount,
} from "../server/mutations/calls";
import { INVITE_TOKEN_ALPHABET } from "../server/random";
import type { ConvexAuthConfig, PermissionsConfig } from "../server/types";

export type { AuthContext, OptionalAuthContext, UserDoc, AuthContextConfig };

/**
 * Create a lightweight auth context object.
 *
 * Returns the same app-facing `user`, `session`, `member`, `group`, `account`,
 * `factor`, `invite`, `key`, `context`, and `ctx` APIs as `defineAuth`, but
 * without `signIn`, `signOut`, `store`, `http`, or provider logic.
 *
 * Use this in query/mutation files that only need to resolve the
 * current user — it avoids loading provider, OAuth, and crypto code.
 *
 * @example
 * ```ts
 * // convex/auth-core.ts
 * import { createAuthContext } from "@estifanos-sh/convex-auth/core";
 * import { components } from "./_generated/api";
 *
 * export const auth = createAuthContext(components.auth);
 *
 * // convex/functions.ts
 * import { auth } from "./auth-core";
 * export const authQuery = customQuery(query, auth.ctx());
 * ```
 *
 * @param component - The Convex Auth component reference from `components.auth`.
 * @param config - Optional auth configuration. Provider config is intentionally
 *   omitted in this lightweight entrypoint.
 * @returns The lightweight auth context facade.
 */
export function createAuthContext(
  component: ConvexAuthConfig["component"],
  config?: Omit<AuthConfig, "providers"> & {
    permissions?: PermissionsConfig;
  },
) {
  const fullConfig = configDefaults({
    component,
    providers: [],
    ...config,
  });

  const INVITE_TOKEN_LENGTH = 48;

  const enrichCtx = <T>(ctx: T) => ctx;

  const domains = createCoreDomains({
    config: fullConfig,
    callInvalidateSessions,
    callCreateAccountFromCredentials,
    callRetrieveAccountWithCredentials,
    callModifyAccount,
    getEnrichCtx: () => enrichCtx,
    inviteTokenAlphabet: INVITE_TOKEN_ALPHABET,
    inviteTokenLength: INVITE_TOKEN_LENGTH,
    signInForProvider: async () => {
      throw new Error("Provider sign-in is unavailable in the lightweight auth context.");
    },
    continueWithProvider: async () => {
      throw new Error("Provider continuations are unavailable in the lightweight auth context.");
    },
  });

  const authLike: AuthLike = {
    user: domains.user,
    active: domains.active,
  };

  return {
    user: domains.user,
    session: domains.session,
    account: domains.accountManagement,
    factor: domains.factor,
    group: { ...domains.group, active: domains.active },
    member: domains.member,
    invite: domains.invite,
    key: domains.key,
    ...(createAuthContextFacade(authLike) as AuthContextFacade),
  };
}
