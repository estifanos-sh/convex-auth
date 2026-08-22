import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { ConvexError, type Infer, v } from "convex/values";

import type { Hashed } from "../../shared/brand";
import { ErrorCode } from "../../shared/codes";
import * as Provider from "../crypto";
import { authDb } from "../db";
import type { AuthErrorData } from "../errors";
import { LOG_LEVELS, log, maybeRedact } from "../log";
import type { AuthProfile } from "../payloads";
import { vPayloadRecord } from "../payloads";
import { getAuthSessionId } from "../session/lifecycle";
import type { ConvexCredentialsConfig, Doc, MutationCtx } from "../types";
import { upsertUserAndAccount } from "../user/account";
import { AUTH_STORE_REF } from "./store/refs";

export const vCreateAccountFromCredentialsArgs = v.object({
  provider: v.string(),
  account: v.object({ id: v.string(), secret: v.optional(v.string()) }),
  profile: vPayloadRecord,
  shouldLinkViaEmail: v.optional(v.boolean()),
  shouldLinkViaPhone: v.optional(v.boolean()),
});

type ReturnType = { account: Doc<"Account">; user: Doc<"User"> };

type HashedCredentialsArgs = Omit<Infer<typeof vCreateAccountFromCredentialsArgs>, "account"> & {
  account: { id: string; secret?: string };
};

async function materializeCredentialsAccount(
  ctx: MutationCtx,
  args: HashedCredentialsArgs,
  provider: ConvexCredentialsConfig,
  config: Provider.Config,
): Promise<ReturnType> {
  const db = authDb(ctx, config);
  const result = await upsertUserAndAccount(
    ctx,
    await getAuthSessionId(ctx),
    { providerAccountId: args.account.id, secret: args.account.secret },
    {
      type: "credentials",
      provider,
      profile: args.profile as AuthProfile,
      shouldLinkViaEmail: args.shouldLinkViaEmail,
      shouldLinkViaPhone: args.shouldLinkViaPhone,
    },
    config,
  );
  const [createdAccount, createdUser] = await Promise.all([
    db.accounts.get({ id: result.accountId }) as Promise<Doc<"Account"> | null>,
    db.users.get({ id: result.userId }) as Promise<Doc<"User"> | null>,
  ]);
  if (createdAccount === null) {
    throw new ConvexError<AuthErrorData>({
      code: ErrorCode.ACCOUNT_NOT_FOUND,
      message: "Created account was not found.",
    });
  }
  if (createdUser === null) {
    throw new ConvexError<AuthErrorData>({
      code: ErrorCode.USER_UPDATE_FAILED,
      message: "Created user was not found.",
    });
  }
  return { account: createdAccount, user: createdUser };
}

/**
 * Materialize credentials whose optional secret was hashed before any staged
 * enrollment state was persisted. Existing accounts are rejected so a race
 * cannot silently retarget a continuation to another user.
 *
 * @internal
 */
export async function createAccountFromHashedCredentialsImpl(
  ctx: MutationCtx,
  args: HashedCredentialsArgs,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<ReturnType> {
  const provider = getProviderOrThrow(args.provider) as ConvexCredentialsConfig;
  const existing = await authDb(ctx, config).accounts.get({
    provider: provider.id,
    providerAccountId: args.account.id,
  });
  if (existing !== null) {
    throw new ConvexError<AuthErrorData>({
      code: ErrorCode.ACCOUNT_ALREADY_LINKED,
      message: "This credentials account was linked while enrollment was in progress.",
    });
  }
  return await materializeCredentialsAccount(ctx, args, provider, config);
}

export async function createAccountFromCredentialsImpl(
  ctx: MutationCtx,
  args: Infer<typeof vCreateAccountFromCredentialsArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<ReturnType> {
  log(LOG_LEVELS.DEBUG, "createAccountFromCredentialsImpl args:", {
    provider: args.provider,
    account: {
      id: args.account.id,
      secret: maybeRedact(args.account.secret ?? ""),
    },
  });

  const { provider: providerId, account, profile, shouldLinkViaEmail, shouldLinkViaPhone } = args;
  const db = authDb(ctx, config);
  const provider = getProviderOrThrow(providerId) as ConvexCredentialsConfig;
  const typedProfile = profile as AuthProfile;

  const existingAccount = (await db.accounts.get({
    provider: provider.id,
    providerAccountId: account.id,
  })) as Doc<"Account"> | null;

  if (existingAccount === null) {
    const accountSecret = account.secret;
    const secret =
      accountSecret === undefined ? undefined : await Provider.hash(provider, accountSecret);

    return await materializeCredentialsAccount(
      ctx,
      {
        provider: providerId,
        account: { id: account.id, ...(secret === undefined ? {} : { secret }) },
        profile: typedProfile,
        shouldLinkViaEmail,
        shouldLinkViaPhone,
      },
      provider,
      config,
    );
  } else {
    if (account.secret !== undefined) {
      const accountSecret = account.secret;
      const valid = await Provider.verify(
        provider,
        accountSecret,
        (existingAccount.secret ?? "") as Hashed<"Password">,
      );
      if (!valid) {
        throw new ConvexError<AuthErrorData>({
          code: ErrorCode.INVALID_CREDENTIALS,
          message: "Invalid credentials.",
        });
      }
    }

    const user = (await db.users.get({ id: existingAccount.userId })) as Doc<"User"> | null;
    if (user === null) {
      throw new ConvexError<AuthErrorData>({
        code: ErrorCode.ACCOUNT_NOT_FOUND,
        message: `Linked user for account ${account.id} was not found.`,
      });
    }

    return { account: existingAccount, user };
  }
}

export const callCreateAccountFromCredentials = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof vCreateAccountFromCredentialsArgs>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "createAccountFromCredentials",
      ...args,
    },
  }) as Promise<ReturnType>;
};
