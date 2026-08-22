/**
 * Auth configuration helpers for Convex Auth.
 *
 * @module
 */

import type { HttpRouter, RegisteredAction } from "convex/server";
import { ConvexError } from "convex/values";
import type { GenericId, GenericValidator, Infer } from "convex/values";

import { ErrorCode } from "../shared/codes";
import type { AuthTokens, SignInFlowResult } from "../shared/results";
import { createAuthContextFacade } from "./facade";
import type { McpToolDef } from "./mcp";
import type {
  AuthConfig,
  AuthContext,
  AuthContextConfig,
  AuthContextFactory,
  AuthContextResolver,
  OptionalAuthContext,
  OptionalAuthContextFactory,
  OptionalAuthContextResolver,
} from "./facade";
import { Auth as AuthFactory } from "./runtime";
import { createAuthValidators } from "./validators";
import type { AuthExtendValidators, AuthValidators } from "./validators";
import type {
  AuthProviderConfig,
  AuthSignInArgs,
  AuthSignInAction,
  ConvexAuthConfig,
  Grant,
  PermissionsConfig,
  RoleId,
} from "./types";

export type { AuthConfig, AuthContext, AuthContextConfig, OptionalAuthContext };
export type { AuthExtendValidators, AuthValidators };

/**
 * `member.get`/`member.assert` result with `roleIds`/`grants` narrowed
 * from `string[]` to the permission-typed literal unions.
 */
type PageWithItem<TPage, Item> = Omit<TPage, "page"> & { page: Item[] };

type AuthUser<TExtend extends AuthExtendValidators> = Infer<AuthValidators<TExtend>["user"]>;
type AuthGroup<TExtend extends AuthExtendValidators> = Infer<AuthValidators<TExtend>["group"]>;
type AuthMember<TExtend extends AuthExtendValidators> = Infer<AuthValidators<TExtend>["member"]>;
type AuthInvite<TExtend extends AuthExtendValidators> = Infer<AuthValidators<TExtend>["invite"]>;
type ExtendInput<
  TExtend extends AuthExtendValidators,
  TTable extends keyof AuthExtendValidators,
> = TExtend[TTable] extends GenericValidator ? Infer<TExtend[TTable]> : unknown;

type MemberAccessResult<
  TPermissions extends PermissionsConfig | undefined,
  TExtend extends AuthExtendValidators,
> = Omit<
  Awaited<ReturnType<RuntimeAuthApi["member"]["assert"]>>,
  "membership" | "roleIds" | "grants"
> & {
  membership: AuthMember<TExtend> | null;
  roleIds: RoleId<TPermissions>[];
  grants: Grant<TPermissions>[];
};

type MemberResolutionResult<
  TPermissions extends PermissionsConfig | undefined,
  TExtend extends AuthExtendValidators,
> = Omit<
  Awaited<ReturnType<RuntimeAuthApi["member"]["resolve"]>>,
  "membership" | "roleIds" | "grants"
> & {
  membership: AuthMember<TExtend> | null;
  roleIds: RoleId<TPermissions>[];
  grants: Grant<TPermissions>[];
};

/**
 * Runtime component APIs are generated without this config's `extend`
 * validators. Keep that one unavoidable generic projection at the facade
 * boundary, after every public shape has been derived from those validators.
 *
 * @internal
 */
function projectPublicApi<T>(value: unknown): T {
  return value as T;
}

type UserApiWithExtend<TExtend extends AuthExtendValidators> = Omit<
  RuntimeAuthApi["user"],
  "get" | "list" | "update" | "viewer"
> & {
  get: {
    (
      ctx: Parameters<RuntimeAuthApi["user"]["list"]>[0],
      args: { id: GenericId<"User"> },
    ): Promise<AuthUser<TExtend> | null>;
    (
      ctx: Parameters<RuntimeAuthApi["user"]["list"]>[0],
      args: { ids: readonly GenericId<"User">[] },
    ): Promise<Array<AuthUser<TExtend> | null>>;
  };
  list: (
    ...args: Parameters<RuntimeAuthApi["user"]["list"]>
  ) => Promise<
    PageWithItem<Awaited<ReturnType<RuntimeAuthApi["user"]["list"]>>, AuthUser<TExtend>>
  >;
  viewer: (
    ctx: Parameters<RuntimeAuthApi["user"]["viewer"]>[0],
  ) => Promise<AuthUser<TExtend> | null>;
  update: (
    ctx: Parameters<RuntimeAuthApi["user"]["update"]>[0],
    args: {
      id: GenericId<"User">;
      patch: {
        name?: string;
        firstName?: string;
        lastName?: string;
        image?: string;
        extend?: ExtendInput<TExtend, "User">;
      };
    },
  ) => Promise<null>;
};

type GroupApiWithExtend<TExtend extends AuthExtendValidators> = Omit<
  RuntimeAuthApi["group"],
  "create" | "get" | "list" | "update" | "ancestors"
> & {
  create: (
    ctx: Parameters<RuntimeAuthApi["group"]["create"]>[0],
    args: {
      data: Omit<Parameters<RuntimeAuthApi["group"]["create"]>[1]["data"], "extend"> & {
        extend?: ExtendInput<TExtend, "Group">;
      };
    },
  ) => ReturnType<RuntimeAuthApi["group"]["create"]>;
  get: {
    (
      ctx: Parameters<RuntimeAuthApi["group"]["list"]>[0],
      args: { id: GenericId<"Group"> },
    ): Promise<AuthGroup<TExtend> | null>;
    (
      ctx: Parameters<RuntimeAuthApi["group"]["list"]>[0],
      args: { ids: readonly GenericId<"Group">[] },
    ): Promise<Array<AuthGroup<TExtend> | null>>;
    (
      ctx: Parameters<RuntimeAuthApi["group"]["list"]>[0],
      args: { slug: string },
    ): Promise<AuthGroup<TExtend> | null>;
  };
  list: (
    ...args: Parameters<RuntimeAuthApi["group"]["list"]>
  ) => Promise<
    PageWithItem<Awaited<ReturnType<RuntimeAuthApi["group"]["list"]>>, AuthGroup<TExtend>>
  >;
  ancestors: (...args: Parameters<RuntimeAuthApi["group"]["ancestors"]>) => Promise<
    Omit<Awaited<ReturnType<RuntimeAuthApi["group"]["ancestors"]>>, "ancestors"> & {
      ancestors: AuthGroup<TExtend>[];
    }
  >;
  update: (
    ctx: Parameters<RuntimeAuthApi["group"]["update"]>[0],
    args: {
      id: GenericId<"Group">;
      patch: {
        name?: string;
        slug?: string;
        type?: string;
        parentGroupId?: GenericId<"Group">;
        extend?: ExtendInput<TExtend, "Group">;
      };
    },
  ) => Promise<null>;
};

type InviteApiWithExtend<TExtend extends AuthExtendValidators> = Omit<
  RuntimeAuthApi["invite"],
  "create" | "get" | "list" | "token"
> & {
  create: (
    ctx: Parameters<RuntimeAuthApi["invite"]["create"]>[0],
    args: {
      data: Omit<Parameters<RuntimeAuthApi["invite"]["create"]>[1]["data"], "extend"> & {
        extend?: ExtendInput<TExtend, "GroupInvite">;
      };
    },
  ) => ReturnType<RuntimeAuthApi["invite"]["create"]>;
  get: (
    ctx: Parameters<RuntimeAuthApi["invite"]["get"]>[0],
    args: { id: GenericId<"GroupInvite"> },
  ) => Promise<AuthInvite<TExtend> | null>;
  list: (
    ...args: Parameters<RuntimeAuthApi["invite"]["list"]>
  ) => Promise<
    PageWithItem<Awaited<ReturnType<RuntimeAuthApi["invite"]["list"]>>, AuthInvite<TExtend>>
  >;
  token: Omit<RuntimeAuthApi["invite"]["token"], "get"> & {
    get: (
      ctx: Parameters<RuntimeAuthApi["invite"]["token"]["get"]>[0],
      args: { token: string },
    ) => Promise<AuthInvite<TExtend> | null>;
  };
};

type MemberApiWithPermissions<
  TPermissions extends PermissionsConfig | undefined,
  TExtend extends AuthExtendValidators,
> = Omit<
  ReturnType<typeof AuthFactory>["auth"]["member"],
  "create" | "list" | "update" | "get" | "resolve" | "assert"
> & {
  create: (
    ctx: Parameters<ReturnType<typeof AuthFactory>["auth"]["member"]["create"]>[0],
    args: {
      data: {
        groupId: GenericId<"Group">;
        userId: GenericId<"User">;
        roleIds?: RoleId<TPermissions>[];
        status?: string;
        extend?: ExtendInput<TExtend, "GroupMember">;
      };
    },
  ) => Promise<GenericId<"GroupMember">>;
  list: (
    ...args: Parameters<RuntimeAuthApi["member"]["list"]>
  ) => Promise<
    PageWithItem<Awaited<ReturnType<RuntimeAuthApi["member"]["list"]>>, AuthMember<TExtend>>
  >;
  update: (
    ctx: Parameters<ReturnType<typeof AuthFactory>["auth"]["member"]["update"]>[0],
    args: {
      id: GenericId<"GroupMember">;
      patch: {
        roleIds?: RoleId<TPermissions>[];
        status?: string;
        extend?: ExtendInput<TExtend, "GroupMember">;
      };
    },
  ) => Promise<null>;
  get: {
    (
      ctx: Parameters<ReturnType<typeof AuthFactory>["auth"]["member"]["get"]>[0],
      args: { userId: GenericId<"User">; groupId: GenericId<"Group"> },
    ): Promise<MemberAccessResult<TPermissions, TExtend>>;
    (
      ctx: Parameters<ReturnType<typeof AuthFactory>["auth"]["member"]["get"]>[0],
      args: { userId: GenericId<"User">; groupIds: readonly GenericId<"Group">[] },
    ): Promise<MemberAccessResult<TPermissions, TExtend>[]>;
  };
  resolve: (
    ctx: Parameters<ReturnType<typeof AuthFactory>["auth"]["member"]["resolve"]>[0],
    args: { userId: GenericId<"User">; groupId: GenericId<"Group">; maxDepth?: number },
  ) => Promise<MemberResolutionResult<TPermissions, TExtend>>;
  assert: (
    ctx: Parameters<ReturnType<typeof AuthFactory>["auth"]["member"]["assert"]>[0],
    opts: {
      userId: GenericId<"User">;
      groupId: GenericId<"Group">;
      roleIds?: RoleId<TPermissions>[];
      grants?: Grant<TPermissions>[];
    },
  ) => Promise<MemberAccessResult<TPermissions, TExtend>>;
};

type RuntimeAuthApi = ReturnType<typeof AuthFactory>["auth"];

/** App-facing account management. Provider credential internals remain on provider callback ctx. */
type PublicAccountApi = RuntimeAuthApi["accountManagement"];

/** App-facing OAuth administration and consent; wire-protocol helpers stay runtime-internal. */
type PublicOAuthApi = {
  authorize: RuntimeAuthApi["oauth"]["code"]["authorize"];
  client: Omit<RuntimeAuthApi["oauth"]["client"], "verify" | "verifyRegistrationToken">;
};

/** Audit event read/write surface for app-owned domain events. */
type PublicEventApi = RuntimeAuthApi["event"];

/**
 * `request.mcp` with each tool's `scope` narrowed from `string` to the
 * permission-typed grant union — a tool may only require a declared grant, so a
 * typo or stale scope is a compile error.
 */
type RequestApiWithPermissions<TPermissions extends PermissionsConfig | undefined> = Omit<
  ReturnType<typeof AuthFactory>["auth"]["request"],
  "mcp" | "router"
> & {
  mcp: <T extends Record<string, GenericValidator>>(
    http: HttpRouter,
    tools: { [K in keyof T]: McpToolDef<T[K], Grant<TPermissions>> },
    opts?: { name?: string; version?: string; mcpPath?: string },
  ) => void;
};

/**
 * The base auth API surface returned by {@link defineAuth}.
 *
 * Provides core namespaces — `signIn`, `signOut`, `user`, `session`,
 * `member`, `invite`, `group`, `key`, and `request` — that are
 * always available regardless of which providers are configured.
 * Use this type when you want to describe code that only depends on the
 * standard auth surface and should not assume group connection features exist.
 *
 * @typeParam TPermissions - The permissions config, used to narrow
 *   role IDs and grant strings on the `member` API.
 */
type AuthApiBase<
  TPermissions extends PermissionsConfig | undefined = undefined,
  TExtend extends AuthExtendValidators = {},
> = {
  /**
   * Convex `returns:` validators for the auth read surface.
   *
   * Set these as a function's `returns:` so client-side `useQuery`
   * inference flows end-to-end without hand-rolled validators or DTO
   * mappers. The `extend` field of each document carries the shape
   * supplied via `defineAuth({ extend: { ... } })`.
   *
   * Available validators:
   * - `v.user` / `v.group` / `v.member` — single documents (extend-aware).
   * - `v.invite` — a single group invite document.
   * - `v.viewer` — `User | null`, for a current-user query.
   * - `v.connection.*` — group connection admin facade results.
   * - `v.list(item)` — wraps an item validator in Convex's
   *   `{ page, isDone, continueCursor }` pagination result shape.
   *
   * Compose these for richer reads — e.g. a current user plus their
   * memberships and groups — using the existing `auth.user.viewer`,
   * `auth.member.list`, and `auth.group.get` facade methods.
   *
   * @example
   * ```ts
   * export const viewer = authQuery({
   *   returns: auth.v.viewer,
   *   handler: (ctx) => ctx.auth.user.viewer(ctx),
   * });
   *
   * export const groups = authQuery({
   *   returns: v.union(
   *     v.object({
   *       ...auth.v.user.fields,
   *       memberships: v.array(auth.v.member),
   *       groups: v.array(auth.v.group),
   *     }),
   *     v.null(),
   *   ),
   *   handler: async (ctx) => {
   *     const me = await ctx.auth.user.viewer(ctx);
   *     if (me === null) return null;
   *     const { page: memberships } = await ctx.auth.member.list(ctx, {
   *       where: { userId: me._id },
   *       paginationOpts: { cursor: null, numItems: 25 },
   *     });
   *     const groups = await ctx.auth.group.get(ctx, {
   *       ids: memberships.map((m) => m.groupId),
   *     });
   *     return { ...me, memberships, groups };
   *   },
   * });
   * ```
   */
  v: AuthValidators<TExtend>;
  signIn: ReturnType<typeof AuthFactory>["signIn"];
  signOut: ReturnType<typeof AuthFactory>["signOut"];
  store: ReturnType<typeof AuthFactory>["store"];
  http: ReturnType<typeof AuthFactory>["http"];
  user: UserApiWithExtend<TExtend>;
  session: ReturnType<typeof AuthFactory>["auth"]["session"];
  account: PublicAccountApi;
  factor: RuntimeAuthApi["factor"];
  group: GroupApiWithExtend<TExtend> & {
    /** Current user's active-group selection (`get` / `update` / `reset`). */
    active: ReturnType<typeof AuthFactory>["auth"]["active"];
  };
  member: MemberApiWithPermissions<TPermissions, TExtend>;
  invite: InviteApiWithExtend<TExtend>;
  key: ReturnType<typeof AuthFactory>["auth"]["key"];
  provider: ReturnType<typeof AuthFactory>["auth"]["provider"];
  oauth: PublicOAuthApi;
  event: PublicEventApi;
  request: RequestApiWithPermissions<TPermissions>;
  /**
   * Build app-owned public RPCs for group Connection admin screens.
   *
   * This mirrors Convex component setup: start from the configured auth
   * handle, then mount the Connection routes/functions from that handle.
   */
  connection: PublicGroupConnectionApi;
  /**
   * Resolve the current request's auth context. Framework-agnostic — use
   * this in custom wrappers, middleware, or anywhere you need the current
   * `{ userId, user, groupId, role, grants }` object.
   *
   * This is the authorization-enrichment path. For native identity claims
   * already present on the JWT, prefer `ctx.auth.getUserIdentity()`.
   *
   * Throws a structured `ConvexError` when unauthenticated by default.
   * Use `auth.context.optional(ctx)` to get a null-shaped auth object instead.
   *
   * @param ctx - Convex query, mutation, or action context.
   * @param config - Optional auth resolution config. Supports `require`,
   *   `active`, and `resolve`.
   * @returns The current auth context.
   *
   * @example Direct usage in a handler
   * ```ts
   * const authContext = await auth.context(ctx);
   * const { userId, grants } = authContext;
   * ```
   *
   * @example Optional usage
   * ```ts
   * const authContext = await auth.context.optional(ctx);
   * if (authContext.userId === null) {
   *   return null;
   * }
   * ```
   *
   * @example With resolve
   * ```ts
   * const authContext = await auth.context(ctx, {
   *   resolve: async (_ctx, user, state) => ({
   *     email: user.email,
   *     canWrite: state.grants.includes("posts.write"),
   *   }),
   * });
   * ```
   */
  context: AuthContextResolver & { optional: OptionalAuthContextResolver };
  /**
   * Context enrichment for convex-helpers `customQuery` / `customMutation` /
   * `customAction`.
   *
   * Resolves the current user's identity, active group, membership role,
   * and grants, then attaches them to `ctx.auth`. Returns a `Customization`
   * object compatible with convex-helpers' custom function builders.
   *
   * `ctx.auth` is the current request auth context.
   * By default this throws when unauthenticated so handlers can assume
   * `ctx.auth.userId` and `ctx.auth.user` exist.
   *
   * @returns A convex-helpers `Customization` object.
   *
   * @example One-time setup in `convex/functions.ts`
   * ```ts
   * import { query, mutation, action } from "./_generated/server";
   * import { customQuery, customMutation, customAction } from "convex-helpers/server/customFunctions";
   * import { auth } from "./auth";
   *
   * export const authQuery = customQuery(query, auth.ctx());
   * export const authMutation = customMutation(mutation, auth.ctx());
   * export const authAction = customAction(action, auth.ctx());
   * ```
   *
   * @example Per-function usage
   * ```ts
   * import { authQuery } from "./functions";
   *
   * export const list = authQuery({
   *   args: { workspaceId: v.string() },
   *   handler: async (ctx, args) => {
   *     const { userId, groupId, grants } = ctx.auth;
   *     // business logic
   *   },
   * });
   * ```
   */
  ctx: AuthContextFactory & { optional: OptionalAuthContextFactory };
};

type InternalConnectionApi = ReturnType<typeof AuthFactory>["auth"]["connection"];

type ConnectionValidators = AuthValidators["connection"];
type PublicGroupConnection = Infer<ConnectionValidators["doc"]>;
type PublicConnectionLookup = Infer<ConnectionValidators["lookup"]>;
type PublicConnectionId = Infer<ConnectionValidators["id"]>;
type PublicConnectionCreated = Infer<ConnectionValidators["created"]>;
type PublicConnectionStatus = Infer<ConnectionValidators["status"]>;
type PublicConnectionValidation = Infer<ConnectionValidators["validation"]>;
type PublicConnectionSignIn = Infer<ConnectionValidators["signIn"]>;
type PublicConnectionDomain = Infer<ConnectionValidators["domain"]["doc"]>;
type PublicConnectionDomainValidation = Infer<ConnectionValidators["domain"]["validation"]>;
type PublicConnectionDomainSet = Infer<ConnectionValidators["domain"]["upsert"]>;
type PublicConnectionDomainVerificationRequest = Infer<
  ConnectionValidators["domain"]["verificationRequest"]
>;
type PublicConnectionDomainVerificationConfirm = Infer<
  ConnectionValidators["domain"]["verificationConfirm"]
>;
type PublicConnectionPolicyValidation = Infer<ConnectionValidators["policy"]["validation"]>;
type PublicConnectionScimConfig = Infer<ConnectionValidators["scim"]["config"]>;
type PublicConnectionScimSet = Infer<ConnectionValidators["scim"]["upsert"]>;
type PublicConnectionScimValidation = Infer<ConnectionValidators["scim"]["validation"]>;
type PublicConnectionAuditEvent = Infer<ConnectionValidators["audit"]["event"]>;
type PublicWebhookEndpoint = Infer<ConnectionValidators["webhook"]["endpoint"]>;
type PublicWebhookDelivery = Infer<ConnectionValidators["webhook"]["delivery"]>;
type PublicWebhookDisabled = Infer<ConnectionValidators["webhook"]["disabled"]>;

type WithResult<TFunction, TResult> = TFunction extends (...args: infer TArgs) => unknown
  ? (...args: TArgs) => Promise<TResult>
  : never;

type InternalGroupConnectionApi = InternalConnectionApi["connection"];

type GroupConnectionApiWithExactIds = Omit<
  InternalGroupConnectionApi,
  "create" | "get" | "list" | "update" | "remove" | "status"
> & {
  create: WithResult<InternalGroupConnectionApi["create"], PublicConnectionCreated>;
  get: {
    (
      ctx: Parameters<InternalConnectionApi["connection"]["get"]>[0],
      args: { id: GenericId<"GroupConnection"> },
    ): Promise<PublicGroupConnection | null>;
    (
      ctx: Parameters<InternalConnectionApi["connection"]["get"]>[0],
      args: { domain: string },
    ): Promise<PublicConnectionLookup>;
  };
  list: WithResult<
    InternalGroupConnectionApi["list"],
    PageWithItem<Awaited<ReturnType<InternalGroupConnectionApi["list"]>>, PublicGroupConnection>
  >;
  update: WithResult<InternalGroupConnectionApi["update"], PublicConnectionId>;
  remove: WithResult<InternalGroupConnectionApi["remove"], PublicConnectionId>;
  status: WithResult<InternalGroupConnectionApi["status"], PublicConnectionStatus>;
};

type InternalWebhookEndpointApi = InternalConnectionApi["webhook"]["endpoint"];
type PublicWebhookEndpointApi = Omit<
  InternalWebhookEndpointApi,
  "create" | "get" | "list" | "update" | "revoke"
> & {
  create: WithResult<InternalWebhookEndpointApi["create"], PublicWebhookDisabled>;
  get: (
    ctx: Parameters<InternalWebhookEndpointApi["get"]>[0],
    args: { id: GenericId<"GroupWebhookEndpoint"> },
  ) => Promise<PublicWebhookEndpoint | null>;
  list: (
    ctx: Parameters<InternalWebhookEndpointApi["list"]>[0],
    args: { connectionId: GenericId<"GroupConnection"> },
  ) => Promise<PublicWebhookEndpoint[]>;
  update: WithResult<InternalWebhookEndpointApi["update"], PublicWebhookDisabled>;
  revoke: (
    ctx: Parameters<InternalWebhookEndpointApi["revoke"]>[0],
    args: { id: GenericId<"GroupWebhookEndpoint"> },
  ) => Promise<PublicWebhookDisabled>;
};

type PublicGroupConnectionApi = GroupConnectionApiWithExactIds & {
  signIn: (
    ctx: Parameters<InternalConnectionApi["oidc"]["signIn"]>[0],
    data:
      | {
          connectionId: string;
          email?: never;
          domain?: never;
          redirectTo?: string;
          loginHint?: string;
        }
      | {
          connectionId?: never;
          email: string;
          domain?: never;
          redirectTo?: string;
          loginHint?: string;
        }
      | {
          connectionId?: never;
          email?: never;
          domain: string;
          redirectTo?: string;
          loginHint?: string;
        },
  ) => Promise<PublicConnectionSignIn>;
  metadata: InternalConnectionApi["saml"]["metadata"];
  domain: {
    list: WithResult<InternalConnectionApi["domain"]["list"], PublicConnectionDomain[]>;
    validate: WithResult<
      InternalConnectionApi["domain"]["validate"],
      PublicConnectionDomainValidation
    >;
    status: InternalConnectionApi["domain"]["status"];
    upsert: (
      ctx: Parameters<InternalConnectionApi["connection"]["create"]>[0],
      args: {
        connectionId: string;
        domains: Array<{
          domain: string;
          isPrimary?: boolean;
        }>;
      },
    ) => Promise<PublicConnectionDomainSet>;
    verification: {
      request: (
        ctx: Parameters<InternalConnectionApi["connection"]["create"]>[0],
        args: { connectionId: string; domain: string },
      ) => Promise<PublicConnectionDomainVerificationRequest>;
      confirm: (
        ctx: Parameters<InternalConnectionApi["connection"]["create"]>[0],
        args: { connectionId: string; domain: string },
      ) => Promise<PublicConnectionDomainVerificationConfirm>;
    };
  };
  oidc: Omit<InternalConnectionApi["oidc"], "signIn" | "validate"> & {
    validate: WithResult<InternalConnectionApi["oidc"]["validate"], PublicConnectionValidation>;
  };
  saml: Omit<InternalConnectionApi["saml"], "upsert" | "validate"> & {
    upsert: WithResult<InternalConnectionApi["saml"]["upsert"], PublicConnectionCreated>;
    validate: WithResult<InternalConnectionApi["saml"]["validate"], PublicConnectionValidation>;
  };
  policy: Omit<InternalConnectionApi["policy"], "validate"> & {
    validate: WithResult<
      InternalConnectionApi["policy"]["validate"],
      PublicConnectionPolicyValidation
    >;
  };
  audit: {
    list: WithResult<
      InternalConnectionApi["audit"]["list"],
      PageWithItem<
        Awaited<ReturnType<InternalConnectionApi["audit"]["list"]>>,
        PublicConnectionAuditEvent
      >
    >;
  };
  webhook: {
    endpoint: PublicWebhookEndpointApi;
    delivery: {
      list: WithResult<
        InternalConnectionApi["webhook"]["delivery"]["list"],
        PageWithItem<
          Awaited<ReturnType<InternalConnectionApi["webhook"]["delivery"]["list"]>>,
          PublicWebhookDelivery
        >
      >;
    };
  };
  scim: Omit<
    InternalConnectionApi["scim"],
    "getConfigByToken" | "identity" | "upsert" | "get" | "validate"
  > & {
    upsert: WithResult<InternalConnectionApi["scim"]["upsert"], PublicConnectionScimSet>;
    get: WithResult<InternalConnectionApi["scim"]["get"], PublicConnectionScimConfig | null>;
    validate: WithResult<InternalConnectionApi["scim"]["validate"], PublicConnectionScimValidation>;
  };
};

/**
 * Auth API returned by {@link defineAuth}.
 *
 * @typeParam TPermissions - The permissions config, forwarded to
 *   {@link AuthApiBase} for typed role IDs and grant strings.
 */
type AuthApi<
  TPermissions extends PermissionsConfig | undefined = undefined,
  TExtend extends AuthExtendValidators = {},
> = AuthApiBase<TPermissions, TExtend>;

/**
 * The return type of {@link defineAuth}.
 *
 * This lets application code keep a single `defineAuth()` call while getting
 * the canonical auth namespaces, including the flat `auth.connection.*` admin
 * facade for group connections.
 *
 * @typeParam P - The tuple of provider configs passed to `defineAuth`.
 * @typeParam TPermissions - Optional permissions config for typed roles/grants.
 */
type ConvexAuthResult<
  P extends readonly AuthProviderConfig[],
  TPermissions extends PermissionsConfig | undefined = undefined,
  TExtend extends AuthExtendValidators = {},
> = Omit<AuthApi<TPermissions, TExtend>, "signIn"> & {
  /** Provider-derived action contract preserved by Convex code generation. */
  signIn: RegisteredAction<
    "public",
    AuthSignInArgs<P>,
    Promise<SignInFlowResult<AuthTokens | null>>
  >;
};

type DefineAuthRest = Omit<
  AuthConfig<AuthExtendValidators>,
  "providers" | "permissions" | "extend"
> & {
  permissions?: PermissionsConfig;
  extend?: AuthExtendValidators;
};

type ConfigPermissions<Config extends DefineAuthRest> = Config extends {
  permissions: infer TPermissions extends PermissionsConfig;
}
  ? TPermissions
  : undefined;

type ConfigExtend<Config extends DefineAuthRest> = Config extends {
  extend: infer TExtend extends AuthExtendValidators;
}
  ? TExtend
  : {};

/**
 * Define an auth API object.
 *
 * Connection admin RPCs are exposed by wrapping the `auth.connection.*`
 * facade in your own `authMutation`/`authQuery` functions (authorize with
 * `auth.member.assert`), the same pattern as every other namespace.
 *
 * @param component - The installed auth component reference from
 *   `components.auth` in your Convex app definition.
 * @param config - Auth configuration including `providers` and optional
 *   `permissions`. All fields from {@link AuthConfig} are accepted
 *   except `component` (passed as the first argument).
 * @returns The configured auth API, including the `connection` group-admin
 *   facade.
 *
 * @example
 * ```ts
 * export const auth = defineAuth(components.auth, {
 *   providers: [password(), google()],
 *   permissions,
 * });
 * ```
 *
 * @see {@link AuthContextConfig}
 */
export function defineAuth<
  const Providers extends readonly AuthProviderConfig[],
  const Rest extends DefineAuthRest,
>(
  component: ConvexAuthConfig<ConfigExtend<Rest>>["component"],
  config: { providers: readonly [...Providers] } & Rest,
): ConvexAuthResult<Providers, ConfigPermissions<Rest>, ConfigExtend<Rest>> {
  const authResult = AuthFactory({
    ...config,
    component,
    providers: [...(config.providers as readonly AuthProviderConfig[])],
  });
  const {
    domain: domainApi,
    scim: scimApi,
    connection: connectionApi,
    audit: auditApi,
    webhook: webhookApi,
    oidc: oidcApi,
    saml: samlApi,
    ...restConnection
  } = authResult.auth.connection;

  type SetGroupConnectionDomains = PublicGroupConnectionApi["domain"]["upsert"];
  type GroupConnectionDomainInput = Array<{
    domain: string;
    isPrimary?: boolean;
  }>;
  const setGroupConnectionDomains = async (
    ctx: Parameters<SetGroupConnectionDomains>[0],
    args: Parameters<SetGroupConnectionDomains>[1],
  ) => {
    const { connectionId } = args;
    const domains: GroupConnectionDomainInput = args.domains;
    const connection = await connectionApi.get(ctx, { id: connectionId });
    if (connection === null) {
      throw new ConvexError({
        code: ErrorCode.INVALID_PARAMETERS,
        message: "Connection not found.",
      });
    }

    const normalized = domains.map((entry: (typeof domains)[number]) => ({
      ...entry,
      domain: entry.domain.trim().toLowerCase(),
    }));
    const deduped = new Map<string, (typeof normalized)[number]>();
    for (const entry of normalized) {
      if (entry.domain.length === 0) {
        throw new ConvexError({
          code: ErrorCode.INVALID_PARAMETERS,
          message: "Domain must not be empty.",
        });
      }
      if (deduped.has(entry.domain)) {
        throw new ConvexError({
          code: ErrorCode.INVALID_PARAMETERS,
          message: `Duplicate domain: ${entry.domain}`,
        });
      }
      deduped.set(entry.domain, entry);
    }

    const nextDomains = [...deduped.values()];
    const primaryCount = nextDomains.filter((entry) => entry.isPrimary).length;
    if (primaryCount > 1) {
      throw new ConvexError({
        code: ErrorCode.INVALID_PARAMETERS,
        message: "Only one primary domain may be set.",
      });
    }
    if (nextDomains.length > 0 && primaryCount === 0) {
      nextDomains[0] = { ...nextDomains[0], isPrimary: true };
    }

    const currentDomains = await domainApi.list(ctx, { connectionId });
    const currentByDomain = new Map<string, (typeof currentDomains)[number]>(
      currentDomains.map((entry: (typeof currentDomains)[number]) => [
        entry.domain.toLowerCase(),
        entry,
      ]),
    );

    for (const existing of currentDomains) {
      if (!deduped.has(existing.domain.toLowerCase())) {
        await domainApi.remove(ctx, { id: existing._id });
      }
    }

    for (const nextDomain of nextDomains) {
      const current = currentByDomain.get(nextDomain.domain);
      if (current && current.isPrimary === Boolean(nextDomain.isPrimary)) {
        continue;
      }
      if (current) {
        await domainApi.remove(ctx, { id: current._id });
      }
      const domainId = await domainApi.create(ctx, {
        connectionId: connection._id,
        groupId: connection.groupId,
        domain: nextDomain.domain,
        isPrimary: Boolean(nextDomain.isPrimary),
      });
      if (current?.verifiedAt !== undefined) {
        await ctx.runMutation(component.connection.domain.verify, {
          id: domainId,
          verifiedAt: current.verifiedAt,
        });
      }
    }

    const updatedDomains = await domainApi.list(ctx, { connectionId });
    return {
      connectionId,
      domains: updatedDomains.map((domain: (typeof updatedDomains)[number]) => ({
        domainId: domain._id,
        domain: domain.domain,
        isPrimary: Boolean(domain.isPrimary),
        verified: domain.verifiedAt !== undefined,
        verifiedAt: domain.verifiedAt ?? null,
      })),
    };
  };

  const publicConnectionApi = projectPublicApi<GroupConnectionApiWithExactIds>(connectionApi);
  const publicWebhookEndpointApi = projectPublicApi<PublicWebhookEndpointApi>(webhookApi.endpoint);
  const publicConnectionSignIn = projectPublicApi<PublicGroupConnectionApi["signIn"]>(
    oidcApi.signIn,
  );
  const publicDomainList = projectPublicApi<PublicGroupConnectionApi["domain"]["list"]>(
    domainApi.list,
  );
  const publicDomainValidate = projectPublicApi<PublicGroupConnectionApi["domain"]["validate"]>(
    domainApi.validate,
  );
  const publicDomainUpsert =
    projectPublicApi<PublicGroupConnectionApi["domain"]["upsert"]>(setGroupConnectionDomains);
  const publicDomainVerificationRequest = projectPublicApi<
    PublicGroupConnectionApi["domain"]["verification"]["request"]
  >(domainApi.verification.request);
  const publicDomainVerificationConfirm = projectPublicApi<
    PublicGroupConnectionApi["domain"]["verification"]["confirm"]
  >(domainApi.verification.confirm);
  const publicOidcApi = projectPublicApi<PublicGroupConnectionApi["oidc"]>(oidcApi);
  const publicSamlApi = projectPublicApi<PublicGroupConnectionApi["saml"]>(samlApi);
  const publicPolicyApi = projectPublicApi<PublicGroupConnectionApi["policy"]>(
    restConnection.policy,
  );
  const publicAuditApi = projectPublicApi<PublicGroupConnectionApi["audit"]>(auditApi);
  const publicWebhookDeliveryApi = projectPublicApi<
    PublicGroupConnectionApi["webhook"]["delivery"]
  >(webhookApi.delivery);
  const publicScimApi = projectPublicApi<PublicGroupConnectionApi["scim"]>(scimApi);

  const publicGroupConnection: PublicGroupConnectionApi = {
    ...restConnection,
    ...publicConnectionApi,
    signIn: publicConnectionSignIn,
    metadata: samlApi.metadata,
    oidc: publicOidcApi,
    saml: publicSamlApi,
    domain: {
      list: publicDomainList,
      validate: publicDomainValidate,
      status: domainApi.status,
      upsert: publicDomainUpsert,
      verification: {
        request: publicDomainVerificationRequest,
        confirm: publicDomainVerificationConfirm,
      },
    },
    policy: publicPolicyApi,
    audit: publicAuditApi,
    webhook: {
      endpoint: publicWebhookEndpointApi,
      delivery: publicWebhookDeliveryApi,
    },
    scim: publicScimApi,
  };

  const groupApi = {
    ...authResult.auth.group,
    active: {
      get: authResult.auth.active.get,
      update: authResult.auth.active.update,
      reset: authResult.auth.active.reset,
    },
  };

  const accountApi: PublicAccountApi = authResult.auth.accountManagement;

  const memberApi = projectPublicApi<
    MemberApiWithPermissions<ConfigPermissions<Rest>, ConfigExtend<Rest>>
  >(authResult.auth.member);

  const oauthApi: PublicOAuthApi = {
    authorize: (ctx, args) => authResult.auth.oauth.code.authorize(ctx, args),
    client: {
      create: (ctx, args) => authResult.auth.oauth.client.create(ctx, args),
      get: (ctx, args) => authResult.auth.oauth.client.get(ctx, args),
      list: (ctx, args) => authResult.auth.oauth.client.list(ctx, args),
      update: (ctx, args) => authResult.auth.oauth.client.update(ctx, args),
      revoke: (ctx, args) => authResult.auth.oauth.client.revoke(ctx, args),
    },
  };

  const eventApi: PublicEventApi = authResult.auth.event;

  const api: ConvexAuthResult<Providers, ConfigPermissions<Rest>, ConfigExtend<Rest>> = {
    v: createAuthValidators<ConfigExtend<Rest>>(config.extend as ConfigExtend<Rest> | undefined),
    signIn: authResult.signIn as AuthSignInAction<Providers>,
    signOut: authResult.signOut,
    store: authResult.store,
    http: authResult.http,
    user: projectPublicApi<UserApiWithExtend<ConfigExtend<Rest>>>(authResult.auth.user),
    session: authResult.auth.session,
    account: accountApi,
    factor: authResult.auth.factor,
    group: projectPublicApi<
      GroupApiWithExtend<ConfigExtend<Rest>> & {
        active: ReturnType<typeof AuthFactory>["auth"]["active"];
      }
    >(groupApi),
    member: memberApi,
    invite: projectPublicApi<InviteApiWithExtend<ConfigExtend<Rest>>>(authResult.auth.invite),
    key: authResult.auth.key,
    provider: authResult.auth.provider,
    oauth: oauthApi,
    event: eventApi,
    request: authResult.auth.request,
    connection: publicGroupConnection,

    ...createAuthContextFacade(authResult.auth),
  };
  return api;
}
