/**
 * Credentials provider for custom authentication flows.
 *
 * ```ts
 * import { credentials } from "@robelest/convex-auth/providers";
 *
 * credentials({
 *   authorize: async (credentials, ctx) => {
 *     // Your custom logic here...
 *   },
 * })
 * ```
 *
 * @module
 */

import { GenericDataModel } from "convex/server";
import { GenericId, Value } from "convex/values";

import type { Hashed } from "../shared/brand";
import type { SignInFlowResult } from "../shared/results";
import type { SessionIssuance } from "../server/session/lifecycle";
import type { AuthProfile } from "../server/payloads";
import type {
  AuthProviderConfig,
  ConvexCredentialsConfig,
  GenericActionCtxWithAuthConfig,
} from "../server/types";

export type CredentialsProvisioning = {
  /** Stable provider-owned identifier and optional credential secret. */
  account: { id: string; secret?: string };
  /** User profile established by the provider's verified ceremony. */
  profile: AuthProfile;
  /** Verified profile fields that may safely match an existing user. */
  match?: Array<"email" | "phone">;
};

export type CredentialsAuthorizeResult =
  | {
      userId: GenericId<"User">;
      sessionId?: GenericId<"Session">;
      /**
       * TOTP step-up hint. `false` skips the verified-TOTP lookup;
       * `true`/`undefined` falls back to it.
       */
      hasTotp?: boolean;
      /**
       * Pre-issued session from a combined verify+issue mutation. When set,
       * the framework skips the second `callSignIn` mutation and finalizes
       * the issuance directly on the action side.
       */
      issuance?: SessionIssuance;
    }
  | {
      /** Provision or retrieve the provider account before issuing a session. */
      provision: CredentialsProvisioning;
      /** TOTP step-up hint for the resulting user. */
      hasTotp?: boolean;
    }
  | Exclude<SignInFlowResult<null>, { kind: "signedIn" }>
  | null;

/** Configuration for the {@link credentials} provider. */
export interface CredentialsConfig<DataModel extends GenericDataModel = GenericDataModel> {
  /** Stable provider identifier used in `signIn("<id>")`. */
  id?: string;
  /**
   * Validate the submitted credentials and return the authenticated user or
   * verified identity to provision.
   * Return `null` to reject the sign-in attempt.
   */
  authorize: (
    credentials: Partial<Record<string, Value | undefined>>,
    ctx: GenericActionCtxWithAuthConfig<DataModel>,
  ) => Promise<CredentialsAuthorizeResult>;
  /** Optional hashing helpers for password-style credential verification. */
  crypto?: {
    hashSecret: (secret: string) => Promise<Hashed<"Password">>;
    verifySecret: (secret: string, hash: Hashed<"Password">) => Promise<boolean>;
  };
  /** Additional providers to register alongside this credentials provider. */
  extraProviders?: (AuthProviderConfig | undefined)[];
}

/**
 * Create a credentials provider for custom sign-in logic.
 *
 * @typeParam DataModel - The Convex data model used by the auth context.
 * @param config - Custom authorization and hashing hooks.
 * @returns A configured credentials provider for `defineAuth`.
 *
 * @example
 * ```ts
 * import { credentials } from "@robelest/convex-auth/providers";
 *
 * credentials({
 *   authorize: async (params, ctx) => {
 *     const user = await lookupUser(params.email, params.password, ctx);
 *     return user ? { userId: user._id } : null;
 *   },
 * })
 * ```
 */
export function credentials<DataModel extends GenericDataModel = GenericDataModel>(
  config: CredentialsConfig<DataModel>,
): ConvexCredentialsConfig<DataModel> {
  return {
    ...config,
    id: config.id ?? "credentials",
    type: "credentials",
  } as ConvexCredentialsConfig<DataModel>;
}
