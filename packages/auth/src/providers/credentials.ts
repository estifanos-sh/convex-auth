/**
 * Credentials provider for custom authentication flows.
 *
 * ```ts
 * import { credentials } from "@estifanos-sh/convex-auth/providers/credentials";
 * import { v } from "convex/values";
 *
 * credentials({
 *   params: v.object({ email: v.string(), password: v.string() }),
 *   authorize: async (credentials, ctx) => {
 *     // Your custom logic here...
 *   },
 * })
 * ```
 *
 * @module
 */

import type { GenericDataModel } from "convex/server";
import type { GenericId, GenericValidator, Infer } from "convex/values";

import type { ProviderParams } from "../shared/params";
import type { SignInFlowResult } from "../shared/results";
import type { SessionIssuance } from "../server/session/lifecycle";
import type { AuthProfile, AuthProfileMatchField } from "../server/payloads";
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
  match?: AuthProfileMatchField[];
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
      /** Stage a verified identity for atomic account + passkey enrollment. */
      provision: CredentialsProvisioning;
      /** TOTP step-up hint for the resulting user. */
      hasTotp?: boolean;
    }
  | Exclude<SignInFlowResult<null>, { kind: "signedIn" }>
  | null;

type CredentialsParams<ParamsValidator extends GenericValidator> =
  Exclude<Infer<ParamsValidator>, undefined> extends infer Params extends ProviderParams
    ? Params
    : never;

type CredentialsAuthorizeParams<ParamsValidator extends GenericValidator> =
  CredentialsParams<ParamsValidator> extends never ? never : Infer<ParamsValidator>;

/** Configuration for the {@link credentials} provider. */
export type CredentialsConfig<
  ParamsValidator extends GenericValidator = GenericValidator,
  DataModel extends GenericDataModel = GenericDataModel,
  Id extends string = string,
> =
  CredentialsParams<ParamsValidator> extends never
    ? never
    : {
        /** Stable provider identifier used in `signIn("<id>")`. */
        id?: Id;
        /**
         * Convex validator for the parameters accepted by this provider.
         *
         * The validator is the single source of truth for the callback parameter
         * type, the generated `api.auth.signIn` reference, and runtime validation.
         */
        params: ParamsValidator;
        /**
         * Validate the submitted credentials and return the authenticated user or
         * verified identity to provision.
         * Return `null` to reject the sign-in attempt.
         */
        authorize: (
          credentials: CredentialsAuthorizeParams<ParamsValidator>,
          ctx: GenericActionCtxWithAuthConfig<DataModel>,
        ) => Promise<CredentialsAuthorizeResult>;
        /** Optional hashing helpers for password-style credential verification. */
        crypto?: {
          hashSecret: (secret: string) => Promise<string>;
          verifySecret: (secret: string, hash: string) => Promise<boolean>;
        };
        /** Additional providers to register alongside this credentials provider. */
        extraProviders?: (AuthProviderConfig | undefined)[];
      };

/**
 * Create a credentials provider for custom sign-in logic.
 *
 * @typeParam DataModel - The Convex data model used by the auth context.
 * @param config - Custom authorization and hashing hooks.
 * @returns A configured credentials provider for `defineAuth`.
 *
 * @example
 * ```ts
 * import { credentials } from "@estifanos-sh/convex-auth/providers/credentials";
 * import { v } from "convex/values";
 *
 * credentials({
 *   params: v.object({ email: v.string(), password: v.string() }),
 *   authorize: async (params, ctx) => {
 *     const user = await lookupUser(params.email, params.password, ctx);
 *     return user ? { userId: user._id } : null;
 *   },
 * })
 * ```
 */
export function credentials<
  const ParamsValidator extends GenericValidator = GenericValidator,
  DataModel extends GenericDataModel = GenericDataModel,
  const Id extends string = "credentials",
>(
  config: CredentialsConfig<ParamsValidator, DataModel, Id>,
): ConvexCredentialsConfig<DataModel, ParamsValidator, Id> {
  return {
    ...config,
    id: config.id ?? "credentials",
    type: "credentials",
  } as ConvexCredentialsConfig<DataModel, ParamsValidator, Id>;
}
