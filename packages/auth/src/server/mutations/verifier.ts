import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { Infer, v } from "convex/values";

import * as Provider from "../crypto";
import { authDb } from "../db";
import { getAuthSessionId } from "../session/lifecycle";
import type { Doc, MutationCtx } from "../types";
import { AUTH_STORE_REF } from "./store/refs";

type VerifierId = Doc<"AuthVerifier">["_id"];

export const vVerifierArgs = v.object({
  signature: v.optional(v.string()),
  expirationTime: v.optional(v.number()),
});

export async function verifierImpl(
  ctx: MutationCtx,
  args: Infer<typeof vVerifierArgs>,
  config: Provider.Config,
): Promise<VerifierId> {
  const sessionId = await getAuthSessionId(ctx);
  const verifierId = await authDb(ctx, config).verifiers.create(
    sessionId ?? undefined,
    args.signature,
    args.expirationTime,
  );
  return verifierId as VerifierId;
}

export const callVerifier = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  signature?: string,
  expirationTime?: number,
): Promise<VerifierId> => {
  const verifierId = await ctx.runMutation(AUTH_STORE_REF, {
    args: { type: "verifier", signature, expirationTime },
  });
  if (typeof verifierId !== "string")
    throw new TypeError("Verifier creation returned an invalid ID.");
  return verifierId as VerifierId;
};
