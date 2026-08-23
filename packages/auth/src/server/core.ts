import { Auth, GenericActionCtx, GenericDataModel } from "convex/server";
import { ConvexError, GenericId } from "convex/values";

import { ErrorCode } from "../shared/codes";
import type { ComponentCtx, ComponentReadCtx } from "./component/context";
import { configDefaults } from "./config";
import { createOAuthClientDomain } from "./oauth/client";
import { createOAuthCodeDomain } from "./oauth/code";
import { createOAuthRefreshDomain } from "./oauth/refresh";
import type { OAuthRuntimeDomain } from "./oauth/domain";
import { getSessionUserId } from "./context";
import { invalidateCtxCache } from "./cache/context";
import { createSessionDomain } from "./domains/session";
import { createContextDomain } from "./domains/context";
import { createKeyDomain } from "./domains/key";
import { createInviteDomain } from "./domains/invite";
import { createMemberDomain } from "./domains/member";
import { createAccountDomain, createAccountManagementDomain } from "./domains/account";
import { createUserDomain } from "./domains/user";
import { createGroupDomain } from "./domains/group";
import { capGrantsForCaller, resolveOAuthCaller } from "./domains/access";
import { createFactorDomain } from "./domains/factor";
import type {
  AuthProviderConfig,
  AuthProviderContinueArgs,
  ConvexCredentialsConfig,
  Doc,
  WebAuthnRotateOperation,
  WebAuthnSignInOperation,
} from "./types";
import type { SignInParams } from "./payloads";
import type { SignInFlowResult } from "../shared/results";

type ComponentAuthReadCtx = ComponentReadCtx & { auth: Auth };

type CreateAccountArgs = {
  provider: string;
  account: { id: string; secret?: string };
  profile: import("./payloads").AuthProfile;
  shouldLinkViaEmail?: boolean;
  shouldLinkViaPhone?: boolean;
};
type GetAccountArgs = { provider: string; account: { id: string; secret?: string } };
type UpdateAccountCredentialsArgs = {
  provider: string;
  account: { id: string; secret: string };
};
type CredentialsAccountResult = {
  account: { _id: string; userId: string; secret?: string | null };
  user: Record<string, unknown>;
};
type ProviderImmediateSignInResult = { userId: string; sessionId: string };
type ProviderDeferredSignInResult = Exclude<SignInFlowResult<null>, { kind: "signedIn" }>;
type ProviderSignInResult = ProviderImmediateSignInResult | ProviderDeferredSignInResult | null;

type CoreDeps = {
  config: ReturnType<typeof configDefaults>;
  callRevokeSessions: <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
    args: { userId: GenericId<"User">; except?: GenericId<"Session">[] },
  ) => Promise<void>;
  callCreateAccountFromCredentials: <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
    args: CreateAccountArgs,
  ) => Promise<CredentialsAccountResult>;
  callGetAccountWithCredentials: <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
    args: GetAccountArgs,
  ) => Promise<
    CredentialsAccountResult | "InvalidAccountId" | "InvalidSecret" | "TooManyFailedAttempts"
  >;
  callUpdateAccount: <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
    args: UpdateAccountCredentialsArgs,
  ) => Promise<void>;
  getEnrichCtx: () => <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
  ) => GenericActionCtx<DataModel>;
  inviteTokenAlphabet: string;
  inviteTokenLength: number;
  signInForProvider: <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
    providerConfig: AuthProviderConfig,
    args: {
      accountId?: GenericId<"Account">;
      params?: SignInParams;
    },
  ) => Promise<ProviderSignInResult>;
  continueWithProvider: <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
    args: AuthProviderContinueArgs,
  ) => Promise<ProviderDeferredSignInResult>;
  stageCredentialEnrollment: <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
    args: {
      verifier: ConvexCredentialsConfig;
      account: { id: string; secret?: string };
      profile: import("./payloads").AuthProfile;
      shouldLinkViaEmail: boolean;
      shouldLinkViaPhone: boolean;
      operation: WebAuthnRotateOperation;
    },
  ) => Promise<ProviderDeferredSignInResult>;
};

/**
 * Build the core auth domains that back the canonical app API surface.
 *
 * Creates the grouped `user`, `session`, `account`, `provider`, `group`,
 * `member`, `invite`, and `key` APIs used by the higher-level auth
 * factory. Each namespace wraps the underlying Convex component functions with
 * application-friendly helpers, result shaping, and documentation-friendly
 * method names.
 *
 * @param deps - Internal component wiring, provider config, and helper
 *   functions needed to construct the domain API surface.
 * @returns The core domain namespaces consumed by the auth factory.
 */
export function createCoreDomains(deps: CoreDeps) {
  const {
    config,
    callRevokeSessions,
    callCreateAccountFromCredentials,
    callGetAccountWithCredentials,
    callUpdateAccount,
    inviteTokenAlphabet,
    inviteTokenLength,
    stageCredentialEnrollment,
  } = deps;

  const roleDefinitions = config.permissions.roles as Record<
    string,
    { label?: string; grants: string[] }
  >;

  const getRoleDefinition = (roleId: string) => {
    return roleDefinitions[roleId] ?? null;
  };

  const normalizeRoleIds = (roleIds?: string[]): string[] => {
    const normalized = Array.from(new Set(roleIds ?? []));
    const invalid = normalized.filter((id) => getRoleDefinition(id) === null);
    if (invalid.length > 0) {
      throw new ConvexError({
        code: ErrorCode.INVALID_ROLE_IDS,
        message: "One or more role IDs are invalid.",
        invalidRoleIds: invalid,
      });
    }
    return normalized;
  };

  const resolveGrantedPermissions = (roleIds?: string[]) => {
    const grants = new Set<string>();
    for (const roleId of roleIds ?? []) {
      const role = getRoleDefinition(roleId);
      if (role === null) continue;
      for (const grant of role.grants) {
        grants.add(grant);
      }
    }
    return Array.from(grants).sort();
  };

  const session = createSessionDomain({ config, callRevokeSessions });
  const context = createContextDomain({ config, resolveGrantedPermissions });
  const key = createKeyDomain({ config });
  const user = createUserDomain({ config });
  const groupDomain = createGroupDomain({ config });
  const member = createMemberDomain({
    config,
    normalizeRoleIds,
    resolveGrantedPermissions,
  });
  const invite = createInviteDomain({
    config,
    inviteTokenAlphabet,
    inviteTokenLength,
    normalizeRoleIds,
  });
  const account = createAccountDomain({
    config,
    callCreateAccountFromCredentials,
    callGetAccountWithCredentials,
    callUpdateAccount,
  });
  const accountManagement = createAccountManagementDomain({ config });
  const factor = createFactorDomain({ config });

  const { groupGet: _groupGet, ...group } = groupDomain;

  const provider = {
    /**
     * Sign in through a specific provider from server-side code.
     *
     * Materializes the supplied provider config, runs the standard sign-in
     * flow, and returns the resulting `userId` and `sessionId` when the
     * provider completes authentication immediately. Returns `null` for
     * providers that require additional client-side steps (for example
     * redirects, email verification, or other non-immediate flows).
     *
     * This helper is useful for trusted server flows where you already know
     * which provider should handle the sign-in and want the same behavior as
     * the public auth API without generating tokens for the client.
     *
     * @param ctx - Convex action context.
     * @param args.provider - Provider configuration object to materialize and use.
     * @param args.accountId - Optional account document ID to sign in with directly.
     * @param args.params - Optional provider-specific parameters forwarded to the sign-in flow.
     * @returns `{ userId, sessionId }` when sign-in succeeds immediately, or `null`
     *   when the provider does not produce an immediate session.
     *
     * @example
     * ```ts
     * const session = await auth.provider.signIn(ctx, {
     *   provider: passwordProvider,
     *   params: { email: "alice@example.com", password: "secret" },
     * });
     *
     * if (!session) {
     *   throw new Error("Provider requires another auth step");
     * }
     * ```
     */
    signIn: async <DataModel extends GenericDataModel>(
      ctx: GenericActionCtx<DataModel>,
      args: {
        provider: AuthProviderConfig;
        accountId?: GenericId<"Account">;
        params?: SignInParams;
      },
    ) => {
      const { provider, ...providerArgs } = args;
      return deps.signInForProvider(ctx, provider, providerArgs);
    },
    /**
     * Continue authentication through another provider without first creating
     * a session.
     *
     * @param ctx - Convex action context.
     * @param args.userId - User whose identity the calling provider proved.
     * @param args.operation - Typed operation returned by the target provider.
     * @returns The deferred provider result for automatic client completion.
     * @example
     * ```ts
     * return await auth.provider.continue(ctx, {
     *   userId,
     *   operation: passkeys.rotate(),
     * });
     * ```
     */
    continue: async <DataModel extends GenericDataModel>(
      ctx: GenericActionCtx<DataModel>,
      args: AuthProviderContinueArgs,
    ) => await deps.continueWithProvider(ctx, args),
  };

  const credentials = {
    /**
     * Verify a credentials-provider account and continue directly into a
     * passkey assertion. No session exists until the passkey completes.
     *
     * @param ctx - Convex action context.
     * @param args.verifier - Configured credentials provider that verifies the secret.
     * @param args.account - Provider account identifier and plaintext secret.
     * @param args.operation - Typed passkey sign-in operation.
     * @returns Deferred passkey options bound to the verified account user.
     */
    verify: async <DataModel extends GenericDataModel>(
      ctx: GenericActionCtx<DataModel>,
      args: {
        verifier: ConvexCredentialsConfig;
        account: { id: string; secret: string };
        operation: WebAuthnSignInOperation;
      },
    ) => {
      const verified = await callGetAccountWithCredentials(ctx, {
        provider: args.verifier.id,
        account: args.account,
      });
      if (typeof verified === "string") {
        throw new ConvexError({
          code:
            verified === "TooManyFailedAttempts"
              ? ErrorCode.RATE_LIMITED
              : ErrorCode.INVALID_CREDENTIALS,
          message:
            verified === "TooManyFailedAttempts"
              ? "Too many failed credentials attempts. Please try again later."
              : "Invalid credentials.",
        });
      }
      return await deps.continueWithProvider(ctx, {
        userId: verified.account.userId as GenericId<"User">,
        operation: args.operation,
      });
    },
    /**
     * Stage a credentials identity (linking a safely matched user when
     * requested), then continue directly into passkey rotation. No user,
     * account, or session is created until the rotation completes.
     *
     * @param ctx - Convex action context.
     * @param args.verifier - Configured credentials provider that hashes the secret.
     * @param args.account - Provider-owned account identifier and optional secret.
     * @param args.profile - Profile used to create or link the auth user.
     * @param args.match - Verified profile fields allowed to link an existing user.
     * @param args.operation - Typed passkey rotation operation.
     * @returns Deferred passkey registration options bound to the staged identity.
     */
    provision: async <DataModel extends GenericDataModel>(
      ctx: GenericActionCtx<DataModel>,
      args: {
        verifier: ConvexCredentialsConfig;
        account: { id: string; secret?: string };
        profile: import("./payloads").AuthProfile;
        match?: import("./payloads").AuthProfileMatchField[];
        operation: WebAuthnRotateOperation;
      },
    ) => {
      const existing = await callGetAccountWithCredentials(ctx, {
        provider: args.verifier.id,
        account: args.account,
      });
      if (typeof existing !== "string") {
        return await deps.continueWithProvider(ctx, {
          userId: existing.account.userId as GenericId<"User">,
          operation: args.operation,
        });
      }
      if (existing !== "InvalidAccountId") {
        throw new ConvexError({
          code:
            existing === "TooManyFailedAttempts"
              ? ErrorCode.RATE_LIMITED
              : ErrorCode.INVALID_CREDENTIALS,
          message:
            existing === "TooManyFailedAttempts"
              ? "Too many failed credentials attempts. Please try again later."
              : "Invalid credentials.",
        });
      }
      return await stageCredentialEnrollment(ctx, {
        verifier: args.verifier,
        account: args.account,
        profile: args.profile,
        shouldLinkViaEmail: args.match?.includes("email") ?? false,
        shouldLinkViaPhone: args.match?.includes("phone") ?? false,
        operation: args.operation,
      });
    },
  };

  /**
   * The current user's active group — a stored preference with deterministic
   * membership fallback.
   */
  const active = {
    /**
     * Resolve the *effective* active group: the stored selection if it is
     * still a current membership, otherwise the user's first membership.
     *
     * @param ctx - Convex query/mutation context with `auth`.
     * @param opts.userId - Target user; defaults to the current session user.
     * @returns `{ groupId, group, membership }`, or `null` when there is no
     *   authenticated user or the user has no memberships.
     *
     * @example
     * ```ts
     * const active = await auth.group.active.get(ctx);
     * if (active) console.log(active.group.name);
     * ```
     */
    get: async (
      ctx: ComponentAuthReadCtx,
      opts?: { userId?: string },
    ): Promise<{
      groupId: string;
      group: Doc<"Group"> | null;
      membership: Doc<"GroupMember">;
      roleIds: string[];
      grants: string[];
    } | null> => {
      const userId = opts?.userId ?? (await getSessionUserId(ctx));
      if (userId === null || userId === undefined) return null;
      const result = (await ctx.runQuery(config.component.group.active.get, { userId })) as {
        groupId: string;
        group: Doc<"Group"> | null;
        membership: Doc<"GroupMember">;
      } | null;
      if (result === null) return null;
      const roleIds = result.membership.roleIds ?? [];
      const caller = await resolveOAuthCaller(ctx);
      return {
        ...result,
        roleIds,
        grants: capGrantsForCaller(caller, userId, resolveGrantedPermissions(roleIds)),
      };
    },
    /**
     * Update the active group, validating the user is a member first.
     *
     * @param ctx - Convex mutation context with `auth`.
     * @param args.groupId - Group to activate.
     * @param args.userId - Target user; defaults to the current session user.
     * @throws `NOT_SIGNED_IN` if no user, `NOT_A_MEMBER` if not a member.
     */
    update: async (
      ctx: ComponentCtx & { auth: Auth },
      args: { groupId: string; userId?: string },
    ): Promise<{ groupId: string }> => {
      const userId = args.userId ?? (await getSessionUserId(ctx));
      if (userId === null || userId === undefined) {
        throw new ConvexError({
          code: ErrorCode.NOT_SIGNED_IN,
          message: "Authentication required.",
        });
      }
      await ctx.runMutation(config.component.group.active.update, {
        userId,
        groupId: args.groupId,
      });
      invalidateCtxCache(ctx, `user:${userId}`);
      return { groupId: args.groupId };
    },
    /**
     * Reset the stored preference to deterministic membership fallback.
     *
     * @param ctx - Convex mutation context with `auth`.
     * @param opts.userId - Target user; defaults to the current session user.
     */
    reset: async (
      ctx: ComponentCtx & { auth: Auth },
      opts?: { userId?: string },
    ): Promise<null> => {
      const userId = opts?.userId ?? (await getSessionUserId(ctx));
      if (userId === null || userId === undefined) {
        throw new ConvexError({
          code: ErrorCode.NOT_SIGNED_IN,
          message: "Authentication required.",
        });
      }
      await ctx.runMutation(config.component.group.active.reset, { userId });
      invalidateCtxCache(ctx, `user:${userId}`);
      return null;
    },
  };

  const oauthClient = createOAuthClientDomain({
    component: config.component,
    events: config.events,
  });
  const oauthCode = createOAuthCodeDomain({
    component: config.component,
    events: config.events,
  });
  const oauthRefresh = createOAuthRefreshDomain({
    component: config.component,
    events: config.events,
  });

  const oauth: OAuthRuntimeDomain = {
    client: oauthClient,
    code: oauthCode,
    refresh: oauthRefresh,
  };

  return {
    user,
    context,
    session,
    account,
    accountManagement,
    factor,
    provider,
    credentials,
    group,
    member,
    invite,
    key,
    active,
    oauth,
  };
}
