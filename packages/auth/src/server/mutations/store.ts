import { type Infer, v } from "convex/values";

import { LOG_LEVELS } from "../log";
import { log } from "../log";
import type { ServerServices } from "../services/resolve";
import type { MutationCtx } from "../types";
import { vModifyAccountArgs, modifyAccountImpl } from "./account";
import { vCreateVerificationCodeArgs, createVerificationCodeImpl } from "./code";
import { vCredentialsSignInArgs, credentialsSignInImpl } from "./credentials/signin";
import { completeCredentialEnrollmentImpl, vCompleteCredentialEnrollmentArgs } from "./enrollment";
import { vInvalidateSessionsArgs, invalidateSessionsImpl } from "./invalidate";
import { vUserOAuthArgs, userOAuthImpl } from "./oauth";
import { vRefreshSessionArgs, refreshSessionImpl } from "./refresh";
import { vCreateAccountFromCredentialsArgs, createAccountFromCredentialsImpl } from "./register";
import {
  vRetrieveAccountWithCredentialsArgs,
  retrieveAccountWithCredentialsImpl,
} from "./retrieve";
import { vVerifierSignatureArgs, verifierSignatureImpl } from "./signature";
import { vSignInArgs, signInSessionImpl } from "./signin";
import { signOutImpl } from "./signout";
import { vVerifierArgs, verifierImpl } from "./verifier";
import { vVerifyCodeAndSignInArgs, verifyCodeAndSignInImpl } from "./verify";

export const vStoreArgs = v.object({
  args: v.union(
    v.object({
      type: v.literal("signIn"),
      ...vSignInArgs.fields,
    }),
    v.object({
      type: v.literal("signOut"),
    }),
    v.object({
      type: v.literal("refreshSession"),
      ...vRefreshSessionArgs.fields,
    }),
    v.object({
      type: v.literal("verifyCodeAndSignIn"),
      ...vVerifyCodeAndSignInArgs.fields,
    }),
    v.object({
      type: v.literal("verifier"),
      ...vVerifierArgs.fields,
    }),
    v.object({
      type: v.literal("verifierSignature"),
      ...vVerifierSignatureArgs.fields,
    }),
    v.object({
      type: v.literal("userOAuth"),
      ...vUserOAuthArgs.fields,
    }),
    v.object({
      type: v.literal("createVerificationCode"),
      ...vCreateVerificationCodeArgs.fields,
    }),
    v.object({
      type: v.literal("createAccountFromCredentials"),
      ...vCreateAccountFromCredentialsArgs.fields,
    }),
    v.object({
      type: v.literal("completeCredentialEnrollment"),
      ...vCompleteCredentialEnrollmentArgs.fields,
    }),
    v.object({
      type: v.literal("retrieveAccountWithCredentials"),
      ...vRetrieveAccountWithCredentialsArgs.fields,
    }),
    v.object({
      type: v.literal("credentialsSignIn"),
      ...vCredentialsSignInArgs.fields,
    }),
    v.object({
      type: v.literal("modifyAccount"),
      ...vModifyAccountArgs.fields,
    }),
    v.object({
      type: v.literal("invalidateSessions"),
      ...vInvalidateSessionsArgs.fields,
    }),
  ),
});

export const storeImpl = async (
  ctx: MutationCtx,
  fnArgs: Infer<typeof vStoreArgs>,
  services: ServerServices,
) => {
  const args = fnArgs.args;
  const config = services.config;
  const getProviderOrThrow = services.providerRegistry.getProviderOrThrow;
  if (args.type !== "refreshSession") {
    log(LOG_LEVELS.DEBUG, `\`auth:store\` type: ${args.type}`);
  }

  switch (args.type) {
    case "signIn":
      return await signInSessionImpl(ctx, args, config);
    case "signOut":
      return await signOutImpl(ctx, config);
    case "refreshSession":
      return await refreshSessionImpl(ctx, args, config);
    case "verifyCodeAndSignIn":
      return await verifyCodeAndSignInImpl(ctx, args, getProviderOrThrow, config);
    case "verifier":
      return await verifierImpl(ctx, args, config);
    case "verifierSignature":
      return await verifierSignatureImpl(ctx, args, config);
    case "userOAuth":
      return await userOAuthImpl(ctx, args, getProviderOrThrow, config);
    case "createVerificationCode":
      return await createVerificationCodeImpl(ctx, args, getProviderOrThrow, config);
    case "createAccountFromCredentials":
      return await createAccountFromCredentialsImpl(ctx, args, getProviderOrThrow, config);
    case "completeCredentialEnrollment":
      return await completeCredentialEnrollmentImpl(ctx, args, services);
    case "retrieveAccountWithCredentials":
      return await retrieveAccountWithCredentialsImpl(ctx, args, getProviderOrThrow, config);
    case "credentialsSignIn":
      return await credentialsSignInImpl(ctx, args, getProviderOrThrow, config);
    case "modifyAccount":
      return await modifyAccountImpl(ctx, args, getProviderOrThrow, config);
    case "invalidateSessions":
      return await invalidateSessionsImpl(ctx, args, config);
  }
};
