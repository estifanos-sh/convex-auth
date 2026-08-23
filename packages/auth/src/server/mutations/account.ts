import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { Infer, v } from "convex/values";

import { ErrorCode } from "../../shared/codes";
import { convexError } from "../errors";
import { GetProviderOrThrowFunc, hash } from "../crypto";
import * as Provider from "../crypto";
import { authDb } from "../db";
import { LOG_LEVELS, log, maybeRedact } from "../log";
import { MutationCtx } from "../types";
import { AUTH_STORE_REF } from "./store/refs";

export const vUpdateAccountArgs = v.object({
  provider: v.string(),
  account: v.object({ id: v.string(), secret: v.string() }),
});

export async function updateAccountImpl(
  ctx: MutationCtx,
  args: Infer<typeof vUpdateAccountArgs>,
  getProviderOrThrow: GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<void> {
  const { provider, account } = args;
  const db = authDb(ctx, config);

  log(LOG_LEVELS.DEBUG, "updateAccountImpl args:", {
    provider,
    account: { id: account.id, secret: maybeRedact(account.secret ?? "") },
  });

  const existingAccount = await db.accounts.get({ provider, providerAccountId: account.id });

  if (existingAccount === null) {
    throw convexError(
      ErrorCode.ACCOUNT_NOT_FOUND,
      `Cannot modify account with ID ${account.id} because it does not exist`,
    );
  }

  const hashedSecret = await hash(getProviderOrThrow(provider), account.secret);
  await db.accounts.update(existingAccount._id, {
    secret: hashedSecret,
  });
}

export const callUpdateAccount = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof vUpdateAccountArgs>,
): Promise<void> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "updateAccount",
      ...args,
    },
  }) as Promise<void>;
};
