import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { Infer, v } from "convex/values";

import * as Provider from "../crypto";
import type { Hashed } from "../../shared/brand";
import { credentialsSignInLimitIdentifier, maxSignInAttempts } from "../limits";
import { LOG_LEVELS, log, maybeRedact } from "../log";
import { Doc, MutationCtx } from "../types";
import { withSpan } from "../utils/span";
import { AUTH_STORE_REF } from "./store/refs";

export const vGetAccountWithCredentialsArgs = v.object({
  provider: v.string(),
  account: v.object({ id: v.string(), secret: v.optional(v.string()) }),
  /**
   * Whether `provider` may resolve against `config.extraProviders`; see
   * `vCreateAccountFromCredentialsArgs` for why it has to cross the wire.
   */
  allowExtraProviders: v.boolean(),
});

type ReturnType =
  | "InvalidAccountId"
  | "TooManyFailedAttempts"
  | "InvalidSecret"
  | { account: Doc<"Account">; user: Doc<"User"> };

export async function getAccountWithCredentialsImpl(
  ctx: MutationCtx,
  args: Infer<typeof vGetAccountWithCredentialsArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<ReturnType> {
  const { provider: providerId, account, allowExtraProviders } = args;
  const limitIdentifier = credentialsSignInLimitIdentifier(providerId, account.id);
  log(LOG_LEVELS.DEBUG, "getAccountWithCredentialsImpl args:", {
    provider: providerId,
    account: { id: account.id, secret: maybeRedact(account.secret ?? "") },
  });

  try {
    const begun = (await ctx.runMutation(config.component.account.beginCredentialsSignIn, {
      provider: providerId,
      providerAccountId: account.id,
      limitIdentifier,
      maxAttemptsPerHour: maxSignInAttempts(config),
      reserveAttempt: account.secret !== undefined,
      includeTotp: false,
    })) as
      | { status: "invalid" | "limited" }
      | { status: "ready"; account: Doc<"Account">; user: Doc<"User"> };
    if (begun.status === "invalid") {
      return "InvalidAccountId" as const;
    }
    if (begun.status === "limited") return "TooManyFailedAttempts" as const;
    if (begun.status !== "ready") return "InvalidAccountId" as const;
    const existingAccount = begun.account;

    if (account.secret !== undefined) {
      const accountSecret = account.secret;
      const valid = await withSpan("convex-auth.credentials.verify", { providerId }, () =>
        Provider.verify(
          getProviderOrThrow(providerId, allowExtraProviders),
          accountSecret,
          (existingAccount.secret ?? "") as Hashed<"Password">,
        ),
      );
      if (!valid) {
        return "InvalidSecret" as const;
      }
      await ctx.runMutation(config.component.account.completeCredentialsSignIn, {
        accountId: existingAccount._id,
        limitIdentifier,
        issueSession: false,
        generateTokens: false,
        sessionExpirationTime: 0,
        refreshTokenExpirationTime: 0,
      });
    }

    return { account: existingAccount, user: begun.user } as ReturnType;
  } catch {
    return "InvalidAccountId" as ReturnType;
  }
}

export const callGetAccountWithCredentials = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof vGetAccountWithCredentialsArgs>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "getAccountWithCredentials",
      ...args,
    },
  }) as Promise<ReturnType>;
};
