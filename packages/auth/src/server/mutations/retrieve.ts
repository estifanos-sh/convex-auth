import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { Infer, v } from "convex/values";

import * as Provider from "../crypto";
import type { Hashed } from "../../shared/brand";
import { maxSignInAttempts } from "../limits";
import { LOG_LEVELS, log, maybeRedact } from "../log";
import { Doc, MutationCtx } from "../types";
import { withSpan } from "../utils/span";
import { AUTH_STORE_REF } from "./store/refs";

export const vRetrieveAccountWithCredentialsArgs = v.object({
  provider: v.string(),
  account: v.object({ id: v.string(), secret: v.optional(v.string()) }),
});

type ReturnType =
  | "InvalidAccountId"
  | "TooManyFailedAttempts"
  | "InvalidSecret"
  | { account: Doc<"Account">; user: Doc<"User"> };

export async function retrieveAccountWithCredentialsImpl(
  ctx: MutationCtx,
  args: Infer<typeof vRetrieveAccountWithCredentialsArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<ReturnType> {
  const { provider: providerId, account } = args;
  log(LOG_LEVELS.DEBUG, "retrieveAccountWithCredentialsImpl args:", {
    provider: providerId,
    account: { id: account.id, secret: maybeRedact(account.secret ?? "") },
  });

  try {
    const begun = (await ctx.runMutation(config.component.account.beginCredentialsSignIn, {
      provider: providerId,
      providerAccountId: account.id,
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
          getProviderOrThrow(providerId),
          accountSecret,
          (existingAccount.secret ?? "") as Hashed<"Password">,
        ),
      );
      if (!valid) {
        return "InvalidSecret" as const;
      }
      await ctx.runMutation(config.component.account.completeCredentialsSignIn, {
        accountId: existingAccount._id,
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

export const callRetrieveAccountWithCredentials = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof vRetrieveAccountWithCredentialsArgs>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "retrieveAccountWithCredentials",
      ...args,
    },
  }) as Promise<ReturnType>;
};
