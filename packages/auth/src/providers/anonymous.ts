/**
 * Anonymous authentication provider.
 *
 * ```ts
 * import { anonymous } from "@estifanos-sh/convex-auth/providers";
 *
 * anonymous()
 * ```
 *
 * @module
 */

import { DocumentByName, GenericDataModel, WithoutSystemFields } from "convex/server";
import { Value } from "convex/values";

import type { ConvexCredentialsConfig, GenericActionCtxWithAuthConfig } from "../server/types";
import { credentials } from "./credentials";

/** Configuration for the {@link anonymous} provider. */
export interface AnonymousConfig<DataModel extends GenericDataModel> {
  /** Stable provider identifier used in `signIn("<id>")`. */
  id?: string;
  /**
   * Optional profile factory used when creating the anonymous user document.
   * Must return a profile that includes `isAnonymous: true`.
   */
  profile?: (
    params: Record<string, Value | undefined>,
    ctx: GenericActionCtxWithAuthConfig<DataModel>,
  ) => WithoutSystemFields<DocumentByName<DataModel, "User">> & {
    isAnonymous: true;
  };
}

function defaultAnonymousProfile<DataModel extends GenericDataModel>() {
  return {
    isAnonymous: true,
  } as WithoutSystemFields<DocumentByName<DataModel, "User">> & {
    isAnonymous: true;
  };
}

/**
 * Create an anonymous sign-in provider.
 *
 * @typeParam DataModel - The Convex data model used by the auth context.
 * @param config - Optional provider id and profile customization.
 * @returns A configured anonymous provider for `defineAuth`.
 *
 * @example
 * ```ts
 * import { anonymous } from "@estifanos-sh/convex-auth/providers";
 *
 * anonymous()
 * ```
 */
export function anonymous<DataModel extends GenericDataModel = GenericDataModel>(
  config: AnonymousConfig<DataModel> = {} as AnonymousConfig<DataModel>,
): ConvexCredentialsConfig {
  const provider = config.id ?? "anonymous";

  return credentials<DataModel>({
    id: provider,
    authorize: async (params, ctx) => {
      const profile = config.profile?.(params, ctx) ?? defaultAnonymousProfile<DataModel>();
      const { user } = await ctx.auth.account.create(ctx, {
        provider,
        account: { id: crypto.randomUUID() },
        profile,
      });
      return { userId: user._id };
    },
    ...config,
  });
}
