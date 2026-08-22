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

import type { DocumentByName, GenericDataModel, WithoutSystemFields } from "convex/server";
import { v } from "convex/values";

import type { AnonymousParams } from "../shared/params";
import type { ConvexCredentialsConfig, GenericActionCtxWithAuthConfig } from "../server/types";
import { credentials } from "./credentials";

const vAnonymousParams = v.optional(v.object({ redirectTo: v.optional(v.string()) }));

/** Configuration for the {@link anonymous} provider. */
export interface AnonymousConfig<
  DataModel extends GenericDataModel,
  Id extends string = "anonymous",
> {
  /** Stable provider identifier used in `signIn("<id>")`. */
  id?: Id;
  /**
   * Optional profile factory used when creating the anonymous user document.
   * Must return a profile that includes `isAnonymous: true`.
   */
  profile?: (
    params: AnonymousParams,
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
export function anonymous<
  DataModel extends GenericDataModel = GenericDataModel,
  const Id extends string = "anonymous",
>(
  config: AnonymousConfig<DataModel, Id> = {} as AnonymousConfig<DataModel, Id>,
): ConvexCredentialsConfig<DataModel, typeof vAnonymousParams, Id> {
  const provider = (config.id ?? "anonymous") as Id;

  return credentials<typeof vAnonymousParams, DataModel, Id>({
    id: provider,
    params: vAnonymousParams,
    authorize: async (params, ctx) => {
      const profile = config.profile?.(params ?? {}, ctx) ?? defaultAnonymousProfile<DataModel>();
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
