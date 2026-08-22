/**
 * Lightweight auth context resolution — no dependency on `./runtime`.
 *
 * This module contains the pure auth context helpers that `core/index.ts`
 * and other lightweight consumers can import without pulling in the
 * heavyweight provider / OAuth / crypto machinery from `./runtime`.
 *
 * @module
 */

import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";

import { ErrorCode } from "../shared/codes";
import type { ComponentReadCtx } from "./component/context";
import {
  createUnauthenticatedAuthContext,
  getAuthContext as getResolvedAuthContext,
  type AuthContext,
  type AuthContextConfig,
  type AuthLike,
  type OptionalAuthContext,
  type UserDoc,
} from "./context";

export type { AuthContext, AuthContextConfig, OptionalAuthContext, UserDoc };

/**
 * Config for auth setup. Extends the standard auth config
 * minus `component` (which is passed as the first constructor argument).
 */
export type AuthConfig<TExtend = {}> = Omit<
  import("./types").ConvexAuthConfig<TExtend>,
  "component"
>;

type AuthIdentityCtx = {
  auth: {
    getUserIdentity: () => Promise<UserIdentity | null>;
  };
};

type AuthQueryCtx = ComponentReadCtx;

type AuthContextBase = {
  getUserIdentity: () => Promise<UserIdentity | null>;
};

type RequiredAuthContextState = AuthContextBase & AuthContext;

type OptionalAuthContextState = AuthContextBase & OptionalAuthContext;

type ResolvedAuthContext<TResolve> = AuthContext & TResolve;

type ResolvedOptionalAuthContext<TResolve> = OptionalAuthContext & TResolve;

type AuthResolverCtx = AuthIdentityCtx & AuthQueryCtx;

type PublicAuthContextConfig<TResolve extends object, TCtx> = AuthContextConfig<
  TResolve,
  TCtx & AuthResolverCtx
>;

interface AuthContextResolver {
  <TCtx, TResolve extends object = Record<string, never>>(
    ctx: TCtx,
    config?: PublicAuthContextConfig<TResolve, TCtx>,
  ): Promise<ResolvedAuthContext<TResolve>>;
}

interface OptionalAuthContextResolver {
  <TCtx, TResolve extends object = Record<string, never>>(
    ctx: TCtx,
    config?: PublicAuthContextConfig<TResolve, TCtx>,
  ): Promise<ResolvedOptionalAuthContext<TResolve>>;
}

type AuthContextCustomization<TAuth> = {
  args: {};
  input: (
    ctx: AuthResolverCtx,
    _args: Record<string, never>,
    _extra?: unknown,
  ) => Promise<{
    ctx: {
      auth: TAuth;
    };
    args: {};
  }>;
};

interface AuthContextFactory {
  <TResolve extends object = Record<string, never>>(
    config?: AuthContextConfig<TResolve>,
  ): AuthContextCustomization<RequiredAuthContextState & TResolve>;
}

interface OptionalAuthContextFactory {
  <TResolve extends object = Record<string, never>>(
    config?: AuthContextConfig<TResolve>,
  ): AuthContextCustomization<OptionalAuthContextState & TResolve>;
}

type AuthContextFacade = {
  context: AuthContextResolver & { optional: OptionalAuthContextResolver };
  ctx: AuthContextFactory & { optional: OptionalAuthContextFactory };
};

export type {
  AuthContextFacade,
  AuthContextResolver,
  AuthContextFactory,
  OptionalAuthContextResolver,
  OptionalAuthContextFactory,
};

async function resolveConfiguredAuthContext<
  TCtx extends AuthIdentityCtx & AuthQueryCtx,
  TResolve extends object = Record<string, never>,
>(
  auth: AuthLike,
  ctx: TCtx,
  _config?: AuthContextConfig<TResolve, TCtx>,
): Promise<AuthContext | null> {
  return await getResolvedAuthContext(auth, ctx);
}

function createNotSignedInError() {
  return new ConvexError({
    code: ErrorCode.NOT_SIGNED_IN,
    message: "Authentication required.",
  });
}

/** @internal */
export function assertAuthResolverContext<TCtx>(ctx: TCtx): asserts ctx is TCtx & AuthResolverCtx {
  const candidate = ctx as {
    auth?: { getUserIdentity?: unknown };
    runQuery?: unknown;
  } | null;

  if (
    candidate === null ||
    typeof candidate !== "object" ||
    candidate.auth === undefined ||
    candidate.auth === null ||
    typeof candidate.auth !== "object" ||
    typeof candidate.auth.getUserIdentity !== "function" ||
    typeof candidate.runQuery !== "function"
  ) {
    throw new TypeError(
      "auth.context(ctx) requires a Convex function context with auth.getUserIdentity() and runQuery().",
    );
  }
}

/**
 * Resolve the public auth context for a Convex handler context.
 *
 * Enforce the `require` / `active` builder options against a resolved
 * context. Reuses `ctx.auth.assert` for grants so behavior is identical
 * to an inline call.
 *
 * @internal
 */
function enforceAuthRequirements(
  resolved: AuthContext,
  config?: { assert?: string | readonly string[]; active?: true },
) {
  if (config?.active === true && resolved.groupId === null) {
    throw new ConvexError({
      code: ErrorCode.NO_ACTIVE_GROUP,
      message: "An active group is required.",
    });
  }
  if (config?.assert !== undefined) {
    resolved.assert(config.assert);
  }
}

/**
 * This low-level helper underpins `auth.context(...)` and
 * `auth.context.optional(...)`.
 */
async function createPublicAuthContext<
  TCtx extends AuthIdentityCtx & AuthQueryCtx,
  TResolve extends object = Record<string, never>,
>(
  auth: AuthLike,
  ctx: TCtx,
  config: AuthContextConfig<TResolve, TCtx> | undefined,
  optional: boolean,
) {
  const resolved = await resolveConfiguredAuthContext(auth, ctx, config);

  if (resolved === null) {
    if (!optional) {
      throw createNotSignedInError();
    }
    return createUnauthenticatedAuthContext();
  }

  enforceAuthRequirements(resolved, config);

  const extra = config?.resolve ? await config.resolve(ctx, resolved.user, resolved) : {};

  return {
    ...resolved,
    ...extra,
  };
}

/**
 * Create a convex-helpers customization that injects `ctx.auth`.
 *
 * This low-level helper underpins `auth.ctx(...)` and `auth.ctx.optional(...)`.
 */
function createAuthContextCustomization<
  TResolve extends object = Record<string, never>,
  TCtx extends AuthIdentityCtx & {
    runQuery: ComponentReadCtx["runQuery"];
  } = AuthIdentityCtx & ComponentReadCtx,
>(auth: AuthLike, config: AuthContextConfig<TResolve, TCtx> | undefined, optional: boolean) {
  return {
    args: {},
    input: async (ctx: TCtx, _args: Record<string, never>, _extra?: unknown) => {
      const nativeAuth = ctx.auth;
      const getUserIdentity = nativeAuth.getUserIdentity.bind(nativeAuth);
      const resolved = await resolveConfiguredAuthContext(auth, ctx, config);

      if (resolved === null) {
        if (!optional) {
          throw createNotSignedInError();
        }
        return {
          ctx: {
            auth: {
              getUserIdentity,
              ...createUnauthenticatedAuthContext(),
            },
          },
          args: {},
        };
      }

      enforceAuthRequirements(resolved, config);

      const extra = config?.resolve ? await config.resolve(ctx, resolved.user, resolved) : {};

      return {
        ctx: {
          auth: {
            getUserIdentity,
            ...resolved,
            ...extra,
          },
        },
        args: {},
      };
    },
  };
}

/**
 * Build the auth context facade attached to a configured `defineAuth()` result.
 *
 * @internal
 */
export function createAuthContextFacade(auth: AuthLike): AuthContextFacade {
  const context = ((ctx: AuthResolverCtx, config?: AuthContextConfig<any, AuthResolverCtx>) => {
    assertAuthResolverContext(ctx);
    return createPublicAuthContext(auth, ctx, config, false);
  }) as AuthContextFacade["context"];

  context.optional = ((ctx: AuthResolverCtx, config?: AuthContextConfig<any, AuthResolverCtx>) => {
    assertAuthResolverContext(ctx);
    return createPublicAuthContext(auth, ctx, config, true);
  }) as OptionalAuthContextResolver;

  const ctxFactory = ((config?: AuthContextConfig<any, AuthResolverCtx>) =>
    createAuthContextCustomization(auth, config, false)) as AuthContextFacade["ctx"];

  ctxFactory.optional = ((config?: AuthContextConfig<any, AuthResolverCtx>) =>
    createAuthContextCustomization(auth, config, true)) as OptionalAuthContextFactory;

  return {
    context,
    ctx: ctxFactory,
  };
}
