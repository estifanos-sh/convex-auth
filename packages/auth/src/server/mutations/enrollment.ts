/**
 * Atomic credentials provisioning and passkey enrollment completion.
 *
 * @internal
 */

import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { ConvexError, type Infer, v } from "convex/values";

import { ErrorCode } from "../../shared/codes";
import type { AuthErrorData } from "../errors";
import type { ServerServices } from "../services/resolve";
import type { CrossComponentUserDoc, MutationCtx } from "../types";
import { createAccountFromHashedCredentialsImpl } from "./register";
import { AUTH_STORE_REF } from "./store/refs";

const vAttestationEvidence = v.object({
  verifier: v.string(),
  aaguid: v.string(),
  format: v.string(),
  metadataDescription: v.optional(v.string()),
  verifiedAt: v.number(),
  status: v.literal("trusted"),
});

/** Arguments for the single enrollment-commit transaction. */
export const vCompleteCredentialEnrollmentArgs = v.object({
  continuationId: v.string(),
  provider: v.string(),
  credentialId: v.string(),
  publicKey: v.bytes(),
  algorithm: v.number(),
  counter: v.number(),
  transports: v.optional(v.array(v.string())),
  deviceType: v.string(),
  backedUp: v.boolean(),
  name: v.optional(v.string()),
  attestation: v.optional(vAttestationEvidence),
  createdAt: v.number(),
  now: v.number(),
  sessionExpirationTime: v.number(),
  refreshTokenExpirationTime: v.number(),
});

export type CredentialEnrollmentCompletion =
  | { status: "rejected" }
  | {
      status: "accepted";
      passkeyId: string;
      user: CrossComponentUserDoc;
      sessionId: string;
      sessionExpirationTime: number;
      refreshTokenId: string;
      removedPasskeyIds: string[];
      revokedSessions: number;
      passwordChanged: false;
    };

/** Commit the staged identity, credential account, passkey, and session atomically. */
export async function completeCredentialEnrollmentImpl(
  ctx: MutationCtx,
  args: Infer<typeof vCompleteCredentialEnrollmentArgs>,
  services: ServerServices,
): Promise<CredentialEnrollmentCompletion> {
  const enrollment = await ctx.runQuery(services.config.component.token.enrollment.get, {
    continuationId: args.continuationId,
    provider: args.provider,
    now: args.now,
  });
  if (enrollment === null) {
    return { status: "rejected" };
  }

  const provisioned = await createAccountFromHashedCredentialsImpl(
    ctx,
    {
      provider: enrollment.provider,
      account: {
        id: enrollment.providerAccountId,
        ...(enrollment.secret === undefined ? {} : { secret: enrollment.secret }),
      },
      profile: enrollment.profile,
      shouldLinkViaEmail: enrollment.shouldLinkViaEmail,
      shouldLinkViaPhone: enrollment.shouldLinkViaPhone,
    },
    services.providerRegistry.getProviderOrThrow,
    services.config,
  );

  const completed = (await ctx.runMutation(
    services.config.component.factor.passkey.completeEnrollment,
    {
      userId: provisioned.user._id,
      credentialId: args.credentialId,
      publicKey: args.publicKey,
      algorithm: args.algorithm,
      counter: args.counter,
      ...(args.transports === undefined ? {} : { transports: args.transports }),
      deviceType: args.deviceType,
      backedUp: args.backedUp,
      ...(args.name === undefined ? {} : { name: args.name }),
      ...(args.attestation === undefined ? {} : { attestation: args.attestation }),
      createdAt: args.createdAt,
      continuationId: args.continuationId,
      enrollmentId: enrollment._id,
      credentialsAccountId: provisioned.account._id,
      provider: args.provider,
      now: args.now,
      sessionExpirationTime: args.sessionExpirationTime,
      refreshTokenExpirationTime: args.refreshTokenExpirationTime,
    },
  )) as CredentialEnrollmentCompletion;
  if (completed.status === "rejected") {
    throw new ConvexError<AuthErrorData>({
      code: ErrorCode.CONTINUATION_INVALID,
      message: "Invalid or expired credentials enrollment continuation.",
    });
  }
  return completed;
}

/** Call the atomic enrollment-commit store mutation from an auth action. */
export async function callCompleteCredentialEnrollment<DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof vCompleteCredentialEnrollmentArgs>,
): Promise<CredentialEnrollmentCompletion> {
  return (await ctx.runMutation(AUTH_STORE_REF, {
    args: { type: "completeCredentialEnrollment", ...args },
  })) as CredentialEnrollmentCompletion;
}
