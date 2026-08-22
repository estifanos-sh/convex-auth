import { Auth, GenericActionCtx, GenericDataModel } from "convex/server";
import { ConvexError, type GenericId } from "convex/values";

import { ErrorCode } from "../../shared/codes";
import type { ComponentCtx, ComponentReadCtx } from "../component/context";
import { configDefaults } from "../config";
import { getSessionUserId } from "../context";
import { emitAuthEvent } from "../events";
import type { AuthProfile } from "../payloads";
import type { Doc } from "../types";

type AccountCredentials = { id: string; secret?: string };
type CreateAccountArgs = {
  provider: string;
  account: AccountCredentials;
  profile: AuthProfile;
  shouldLinkViaEmail?: boolean;
  shouldLinkViaPhone?: boolean;
};
type GetAccountArgs = { provider: string; account: AccountCredentials };
type UpdateAccountCredentialsArgs = {
  provider: string;
  account: { id: string; secret: string };
};
type CredentialsAccountResult = {
  account: { _id: string; userId: string; secret?: string | null };
  user: Record<string, unknown>;
};

export type AccountDeps = {
  config: ReturnType<typeof configDefaults>;
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
};

export function createAccountDomain(deps: AccountDeps) {
  const { callCreateAccountFromCredentials, callGetAccountWithCredentials, callUpdateAccount } =
    deps;

  return {
    /**
     * Create a new auth account linked to a user.
     *
     * Creates a credentials-based account record for a given provider. If
     * the user does not yet exist, one is created from the supplied
     * `profile`. If `shouldLinkViaEmail` or `shouldLinkViaPhone` is set,
     * the account may be linked to an existing user whose email or phone
     * matches the profile.
     *
     * The `account.secret` (e.g. a hashed password) is optional and
     * depends on the provider type.
     *
     * @param ctx - Convex action context.
     * @param args.provider - The provider ID (e.g. `"password"`, `"credentials"`).
     * @param args.account.id - Provider-specific account identifier (e.g. email address).
     * @param args.account.secret - Optional credential secret (e.g. hashed password).
     * @param args.profile - Profile data used to create or update the user document.
     * @param args.shouldLinkViaEmail - If `true`, link to an existing user by email match.
     * @param args.shouldLinkViaPhone - If `true`, link to an existing user by phone match.
     * @returns The created account and user information.
     *
     * @example
     * ```ts
     * const result = await auth.account.create(ctx, {
     *   provider: "password",
     *   account: { id: "alice@example.com", secret: hashedPassword },
     *   profile: { email: "alice@example.com", name: "Alice" },
     * });
     * ```
     */
    create: async <DataModel extends GenericDataModel>(
      ctx: GenericActionCtx<DataModel>,
      args: CreateAccountArgs,
    ) => {
      const created = await callCreateAccountFromCredentials(ctx, args);
      return { ...created };
    },
    /**
     * Get an auth account by provider and credentials.
     *
     * Looks up an account matching the given provider and account ID,
     * optionally verifying the secret (e.g. password). If the account
     * exists and the credentials are valid, the full account document is
     * returned. Returns `null` if no matching account is found or if the
     * credential verification fails (indicated by a string error from the
     * underlying RPC).
     *
     * @param ctx - Convex action context.
     * @param args.provider - The provider ID (e.g. `"password"`).
     * @param args.account.id - Provider-specific account identifier.
     * @param args.account.secret - Optional credential secret to verify.
     * @returns The account document, or `null` if not found or verification failed.
     *
     * @example
     * ```ts
     * const acct = await auth.account.get(ctx, {
     *   provider: "password",
     *   account: { id: "alice@example.com", secret: plainTextPassword },
     * });
     * if (!acct) throw new Error("Invalid credentials");
     * ```
     */
    get: async <DataModel extends GenericDataModel>(
      ctx: GenericActionCtx<DataModel>,
      args: GetAccountArgs,
    ) => {
      const result = await callGetAccountWithCredentials(ctx, args);
      if (typeof result === "string") {
        return null;
      }
      return result;
    },
    /**
     * Update the credentials (secret) for an existing auth account.
     *
     * Replaces the stored secret for the account identified by `provider`
     * and `account.id`. This is the standard path for password changes
     * and password resets — the new secret is typically a freshly hashed
     * password.
     *
     * @param ctx - Convex action context.
     * @param args.provider - The provider ID (e.g. `"password"`).
     * @param args.account.id - Provider-specific account identifier.
     * @param args.account.secret - The new credential secret to store.
     * @returns `{ accountId }` confirming the update.
     *
     * @example Password reset
     * ```ts
     * await auth.account.update(ctx, {
     *   provider: "password",
     *   account: { id: "alice@example.com", secret: newHashedPassword },
     * });
     * ```
     */
    update: async <DataModel extends GenericDataModel>(
      ctx: GenericActionCtx<DataModel>,
      args: UpdateAccountCredentialsArgs,
    ) => {
      await callUpdateAccount(ctx, args);
      return { accountId: args.account.id };
    },
  };
}

/**
 * A safe, non-secret capability summary for one linked provider account.
 *
 * This deliberately excludes `providerAccountId`, `secret`, and `extend` so
 * app-facing account reads cannot leak credential or provider-private data.
 */
export type AccountSummary = {
  id: GenericId<"Account">;
  userId: GenericId<"User">;
  provider: string;
  createdAt: number;
  emailVerified: boolean;
  phoneVerified: boolean;
};

const FACTOR_ACCOUNT_PROVIDERS = new Set(["passkey"]);

function isFactorAccount(account: Pick<Doc<"Account">, "provider">): boolean {
  return FACTOR_ACCOUNT_PROVIDERS.has(account.provider);
}

function toAccountSummary(account: Doc<"Account">): AccountSummary {
  return {
    id: account._id,
    userId: account.userId,
    provider: account.provider,
    createdAt: account._creationTime,
    emailVerified: account.emailVerified !== undefined,
    phoneVerified: account.phoneVerified !== undefined,
  };
}

/** Build the safe, current-user account-management surface. */
export function createAccountManagementDomain({ config }: Pick<AccountDeps, "config">) {
  const currentUserId = async (ctx: ComponentReadCtx & { auth: Auth }) => {
    const userId = await getSessionUserId(ctx);
    if (userId === null) {
      throw new ConvexError({
        code: ErrorCode.NOT_SIGNED_IN,
        message: "Authentication required.",
      });
    }
    return userId;
  };

  return {
    /**
     * List safe linked-account capabilities for the current user or a bounded
     * batch of users. Batch reads are for app-authorized user lists and avoid
     * one component call per user; they never expose credential material.
     *
     * @param ctx - Convex query or mutation context. Required when reading the
     *   current user's accounts; authorization for an explicit user batch is
     *   owned by the calling app function.
     * @param opts - Optional explicit bounded user batch.
     * @param opts.userIds - User IDs to read in one component call. Duplicate
     *   IDs are ignored and the component caps the batch at 100 users.
     * @param opts.provider - Optional provider ID (for example, `"password"`)
     *   to read only that capability for each user.
     * @returns Safe account capability summaries, with no provider account ID,
     *   credential secret, or extension data.
     *
     * @example Batch accounts for an authorized member list
     * ```ts
     * const accounts = await auth.account.list(ctx, {
     *   userIds: members.map((member) => member.userId),
     *   provider: "password",
     * });
     * ```
     */
    list: async (
      ctx: ComponentReadCtx & { auth: Auth },
      opts?: { userIds?: readonly GenericId<"User">[]; provider?: string },
    ): Promise<AccountSummary[]> => {
      const userIds = opts?.userIds;
      const provider = opts?.provider;
      const args =
        userIds === undefined
          ? { userId: await currentUserId(ctx), provider }
          : { userIds: Array.from(new Set(userIds)), provider };
      const accounts = (await ctx.runQuery(
        config.component.account.list,
        args,
      )) as Doc<"Account">[];
      return accounts.filter((account) => !isFactorAccount(account)).map(toAccountSummary);
    },

    /** Remove one of the current user's linked accounts, preserving a sign-in path. */
    remove: async (
      ctx: ComponentCtx & { auth: Auth },
      args: { id: GenericId<"Account"> },
    ): Promise<{ id: GenericId<"Account"> }> => {
      const userId = await currentUserId(ctx);
      const account = (await ctx.runQuery(config.component.account.get, {
        id: args.id,
      })) as Doc<"Account"> | null;
      if (account === null || account.userId !== userId) {
        throw new ConvexError({
          code: ErrorCode.ACCOUNT_NOT_FOUND,
          message: "Account not found.",
        });
      }
      if (isFactorAccount(account)) {
        throw new ConvexError({
          code: ErrorCode.INVALID_PARAMETERS,
          message: "Manage WebAuthn credentials with auth.factor.remove().",
        });
      }
      await ctx.runMutation(config.component.account.remove, {
        id: args.id,
        userId,
        requireOtherAccount: true,
      });
      await emitAuthEvent(ctx, config, {
        kind: "account.unlinked",
        actor: { type: "user", id: userId },
        subject: { type: "account", id: args.id },
        targets: [{ kind: "user", id: userId }],
        outcome: "success",
        data: { accountId: args.id, provider: account.provider },
      });
      return { id: args.id };
    },
  };
}
