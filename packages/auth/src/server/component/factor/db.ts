/**
 * Typed cross-component wrappers for the factor (TOTP / passkey / device),
 * user, and PKCE-verifier stores.
 *
 * Each function routes through the shared {@link runQuery} / {@link runMutation}
 * boundary helpers and narrows the result to the domain doc type. Split out of
 * `types.ts` (which stays pure config types + inferred doc aliases) — these
 * carry runtime cross-component calls, mirroring the agent component's
 * `validators.ts`-vs-`execution.ts` separation.
 *
 * @module
 */

import type { GenericActionCtx } from "convex/server";
import type { Infer } from "convex/values";

import {
  vAuthContinuationDoc,
  vAuthVerifierDoc,
  vDeviceCodeDoc,
  vPasskeyDoc,
  vTotpFactorDoc,
} from "../../../component/model";
import type { AuthComponentApi } from "../api";
import type {
  AuthDataModel,
  CrossComponentUserDoc,
  WebAuthnAttestationEvidence,
} from "../../types";

type TotpDoc = Infer<typeof vTotpFactorDoc>;

type PasskeyDoc = Infer<typeof vPasskeyDoc>;

type VerifierDoc = Infer<typeof vAuthVerifierDoc>;

type ContinuationDoc = Infer<typeof vAuthContinuationDoc>;

type DeviceDoc = Infer<typeof vDeviceCodeDoc>;

/**
 * Structural context accepted by every cross-component wrapper below: read +
 * write (`runAction` optional so both action and mutation contexts fit) plus the
 * component API pulled off `ctx.auth.config.component` — the one wrapper family
 * that reads the API from the ctx rather than an explicit argument.
 *
 * @internal
 */
export type ComponentCallCtx = {
  runQuery: GenericActionCtx<AuthDataModel>["runQuery"];
  runMutation: GenericActionCtx<AuthDataModel>["runMutation"];
  runAction?: GenericActionCtx<AuthDataModel>["runAction"];
  auth: { config: { component: AuthComponentApi } };
};

/** Fetch a PKCE verifier by ID across the component boundary. */
export async function queryVerifierById(
  ctx: ComponentCallCtx,
  verifierId: string,
): Promise<VerifierDoc | null> {
  return (await ctx.runQuery(ctx.auth.config.component.token.pkce.get, {
    id: verifierId,
  })) as VerifierDoc | null;
}

/** Remove a PKCE verifier by ID across the component boundary. */
export async function mutateVerifierRemove(
  ctx: ComponentCallCtx,
  verifierId: string,
): Promise<void> {
  await ctx.runMutation(ctx.auth.config.component.token.pkce.remove, {
    id: verifierId,
  });
}

/**
 * Atomically consume a PKCE verifier by ID across the component boundary,
 * returning the consumed doc to the single winner and `null` otherwise (unknown
 * / expired / signature mismatch / already consumed). Replaces the racy
 * read-then-remove so concurrent passkey/TOTP ceremonies cannot each consume the
 * same verifier and mint duplicate sessions. When `expectedSignature` is given,
 * the row is consumed only if its signature matches (a mismatch leaves it
 * intact).
 */
export async function consumeVerifierById(
  ctx: ComponentCallCtx,
  verifierId: string,
  expectedSignature?: string,
): Promise<VerifierDoc | null> {
  const args = { id: verifierId };
  if (expectedSignature !== undefined) Object.assign(args, { expectedSignature });
  return (await ctx.runMutation(
    ctx.auth.config.component.token.pkce.consume,
    args,
  )) as VerifierDoc | null;
}

/** Create a provider continuation. */
export async function mutateContinuationCreate(
  ctx: ComponentCallCtx,
  args: {
    userId: string;
    provider: string;
    operation: "rotate";
    expirationTime: number;
  },
): Promise<string> {
  return (await ctx.runMutation(
    ctx.auth.config.component.token.continuation.create,
    args,
  )) as string;
}

/** Create a password-reset continuation. */
export async function mutatePasswordResetContinuationCreate(
  ctx: ComponentCallCtx,
  args: {
    userId: string;
    provider: string;
    operation: "rotate";
    expirationTime: number;
    accountId: string;
    secret: string;
  },
): Promise<string> {
  return (await ctx.runMutation(
    ctx.auth.config.component.token.continuation.createPasswordReset,
    args,
  )) as string;
}

/** Read an unexpired provider continuation. */
export async function queryContinuation(
  ctx: ComponentCallCtx,
  id: string,
): Promise<ContinuationDoc | null> {
  return (await ctx.runQuery(ctx.auth.config.component.token.continuation.get, {
    id,
  })) as ContinuationDoc | null;
}

/** Fetch a TOTP factor by ID across the component boundary. */
export async function queryTotpById(
  ctx: ComponentCallCtx,
  totpId: string,
): Promise<TotpDoc | null> {
  return (await ctx.runQuery(ctx.auth.config.component.factor.totp.get, {
    id: totpId,
  })) as TotpDoc | null;
}

/** Fetch a user's verified TOTP factor across the component boundary. */
export async function queryTotpVerifiedByUserId(
  ctx: ComponentCallCtx,
  userId: string,
): Promise<TotpDoc | null> {
  return (await ctx.runQuery(ctx.auth.config.component.factor.totp.get, {
    verifiedForUserId: userId,
  })) as TotpDoc | null;
}

/** Insert a TOTP factor across the component boundary; returns its ID. */
export async function mutateTotpInsert(
  ctx: ComponentCallCtx,
  args: {
    userId: string;
    secret: ArrayBuffer;
    digits: number;
    period: number;
    verified: boolean;
    name?: string;
    createdAt: number;
  },
): Promise<string> {
  return (await ctx.runMutation(ctx.auth.config.component.factor.totp.create, args)) as string;
}

/** Mark a TOTP factor verified across the component boundary. */
export async function mutateTotpMarkVerified(
  ctx: ComponentCallCtx,
  totpId: string,
  lastUsedAt: number,
): Promise<void> {
  await ctx.runMutation(ctx.auth.config.component.factor.totp.update, {
    id: totpId,
    patch: { verified: true, lastUsedAt },
  });
}

/** Update a TOTP factor's `lastUsedAt` across the component boundary. */
export async function mutateTotpUpdateLastUsed(
  ctx: ComponentCallCtx,
  totpId: string,
  lastUsedAt: number,
): Promise<void> {
  await ctx.runMutation(ctx.auth.config.component.factor.totp.update, {
    id: totpId,
    patch: { lastUsedAt },
  });
}

/** Fetch a passkey by credential ID across the component boundary. */
export async function queryPasskeyByCredentialId(
  ctx: ComponentCallCtx,
  credentialId: string,
): Promise<PasskeyDoc | null> {
  return (await ctx.runQuery(ctx.auth.config.component.factor.passkey.get, {
    credentialId,
  })) as PasskeyDoc | null;
}

/** Create a registration challenge and load registration context in one component transaction. */
export async function mutatePasskeyBeginRegistration(
  ctx: ComponentCallCtx,
  args: {
    userId: string;
    sessionId?: string;
    signature: string;
    expirationTime: number;
  },
): Promise<{
  verifierId: string;
  user: Pick<CrossComponentUserDoc, "email" | "name">;
  credentials: Array<{ id: string; transports?: string[] }>;
}> {
  return (await ctx.runMutation(
    ctx.auth.config.component.factor.passkey.beginRegistration,
    args,
  )) as {
    verifierId: string;
    user: Pick<CrossComponentUserDoc, "email" | "name">;
    credentials: Array<{ id: string; transports?: string[] }>;
  };
}

/** Create a registration challenge bound to a rotation continuation. */
export async function mutatePasskeyBeginRotation(
  ctx: ComponentCallCtx,
  args: {
    continuationId: string;
    provider: string;
    signature: string;
    expirationTime: number;
  },
): Promise<
  | { status: "rejected" }
  | {
      status: "accepted";
      userId: string;
      verifierId: string;
      user: Pick<CrossComponentUserDoc, "email" | "name">;
      credentials: Array<{ id: string; transports?: string[] }>;
    }
> {
  return (await ctx.runMutation(ctx.auth.config.component.factor.passkey.beginRotation, args)) as
    | { status: "rejected" }
    | {
        status: "accepted";
        userId: string;
        verifierId: string;
        user: Pick<CrossComponentUserDoc, "email" | "name">;
        credentials: Array<{ id: string; transports?: string[] }>;
      };
}

/** Create a sign-in challenge and resolve its optional email allow-list atomically. */
export async function mutatePasskeyBeginSignIn(
  ctx: ComponentCallCtx,
  args: {
    sessionId?: string;
    signature: string;
    expirationTime: number;
    verifiedEmail?: string;
  },
): Promise<{
  verifierId: string;
  credentials: Array<{ id: string; transports?: string[] }>;
}> {
  return (await ctx.runMutation(ctx.auth.config.component.factor.passkey.beginSignIn, args)) as {
    verifierId: string;
    credentials: Array<{ id: string; transports?: string[] }>;
  };
}

/** Consume a WebAuthn challenge and load its credential in one component transaction. */
export async function mutatePasskeyBeginAssertion(
  ctx: ComponentCallCtx,
  args: {
    verifierId: string;
    expectedChallenge: string;
    credentialId: string;
  },
): Promise<{ verifierAccepted: boolean; passkey: PasskeyDoc | null }> {
  return (await ctx.runMutation(ctx.auth.config.component.factor.passkey.beginAssertion, {
    verifierId: args.verifierId,
    expectedChallenge: args.expectedChallenge,
    credentialId: args.credentialId,
  })) as { verifierAccepted: boolean; passkey: PasskeyDoc | null };
}

/** Store a verified registration and create its session in one component transaction. */
export async function mutatePasskeyCompleteRegistration(
  ctx: ComponentCallCtx,
  args: {
    userId: string;
    credentialId: string;
    publicKey: ArrayBuffer;
    algorithm: number;
    counter: number;
    transports?: string[];
    deviceType: string;
    backedUp: boolean;
    name?: string;
    attestation?: WebAuthnAttestationEvidence;
    createdAt: number;
    replaceSession?: { sessionId: string; authenticatedUserId: string };
    sessionExpirationTime: number;
    refreshTokenExpirationTime: number;
  },
): Promise<{
  passkeyId: string;
  user: CrossComponentUserDoc;
  sessionId: string;
  refreshTokenId: string;
  replacedSessionId?: string;
}> {
  return (await ctx.runMutation(
    ctx.auth.config.component.factor.passkey.completeRegistration,
    args,
  )) as {
    passkeyId: string;
    user: CrossComponentUserDoc;
    sessionId: string;
    refreshTokenId: string;
    replacedSessionId?: string;
  };
}

/** Rotate passkeys and sessions after a verified continuation registration. */
export async function mutatePasskeyCompleteRotation(
  ctx: ComponentCallCtx,
  args: {
    userId: string;
    credentialId: string;
    publicKey: ArrayBuffer;
    algorithm: number;
    counter: number;
    transports?: string[];
    deviceType: string;
    backedUp: boolean;
    name?: string;
    attestation?: WebAuthnAttestationEvidence;
    createdAt: number;
    continuationId: string;
    provider: string;
    sessionExpirationTime: number;
    refreshTokenExpirationTime: number;
  },
): Promise<
  | { status: "rejected" }
  | {
      status: "accepted";
      passkeyId: string;
      user: CrossComponentUserDoc;
      sessionId: string;
      refreshTokenId: string;
      removedPasskeyIds: string[];
      revokedSessions: number;
      passwordChanged: boolean;
    }
> {
  return (await ctx.runMutation(
    ctx.auth.config.component.factor.passkey.completeRotation,
    args,
  )) as
    | { status: "rejected" }
    | {
        status: "accepted";
        passkeyId: string;
        user: CrossComponentUserDoc;
        sessionId: string;
        refreshTokenId: string;
        removedPasskeyIds: string[];
        revokedSessions: number;
        passwordChanged: boolean;
      };
}

/**
 * Atomically accept a passkey signature counter (anti-cloning) and update
 * `lastUsedAt` across the component boundary.
 */
export async function mutatePasskeyUpdateCounter(
  ctx: ComponentCallCtx,
  passkeyId: string,
  counter: number,
  lastUsedAt: number,
  backedUp: boolean,
): Promise<boolean> {
  return (await ctx.runMutation(ctx.auth.config.component.factor.passkey.acceptAssertion, {
    id: passkeyId,
    counter,
    lastUsedAt,
    backedUp,
  })) as boolean;
}

/** Atomically accept a verified assertion and create its session. */
export async function mutatePasskeyCompleteAssertion(
  ctx: ComponentCallCtx,
  args: {
    id: string;
    counter: number;
    lastUsedAt: number;
    backedUp: boolean;
    replaceSession?: { sessionId: string; authenticatedUserId: string };
    sessionExpirationTime: number;
    refreshTokenExpirationTime: number;
  },
): Promise<
  | { status: "rejected" }
  | {
      status: "accepted";
      user: CrossComponentUserDoc;
      sessionId: string;
      refreshTokenId: string;
      replacedSessionId?: string;
    }
> {
  return (await ctx.runMutation(
    ctx.auth.config.component.factor.passkey.completeAssertion,
    args,
  )) as
    | { status: "rejected" }
    | {
        status: "accepted";
        user: CrossComponentUserDoc;
        sessionId: string;
        refreshTokenId: string;
        replacedSessionId?: string;
      };
}

/** Insert a device-authorization record across the component boundary; returns its ID. */
export async function mutateDeviceInsert(
  ctx: ComponentCallCtx,
  args: {
    deviceCodeHash: string;
    userCode: string;
    expiresAt: number;
    interval: number;
    status: "pending" | "authorized" | "denied";
  },
): Promise<string> {
  return (await ctx.runMutation(ctx.auth.config.component.factor.device.create, args)) as string;
}

/** Fetch a device-authorization record by code hash across the component boundary. */
export async function queryDeviceByCodeHash(
  ctx: ComponentCallCtx,
  deviceCodeHash: string,
): Promise<DeviceDoc | null> {
  return (await ctx.runQuery(ctx.auth.config.component.factor.device.get, {
    deviceCodeHash,
  })) as DeviceDoc | null;
}

/** Fetch a device-authorization record by user code across the component boundary. */
export async function queryDeviceByUserCode(
  ctx: ComponentCallCtx,
  userCode: string,
): Promise<DeviceDoc | null> {
  return (await ctx.runQuery(ctx.auth.config.component.factor.device.get, {
    userCode,
  })) as DeviceDoc | null;
}

/** Update a device-authorization record's `lastPolledAt` across the component boundary. */
export async function mutateDeviceUpdateLastPolled(
  ctx: ComponentCallCtx,
  deviceId: string,
  lastPolledAt: number,
): Promise<void> {
  await ctx.runMutation(ctx.auth.config.component.factor.device.update, {
    id: deviceId,
    patch: { lastPolledAt },
  });
}

/** Remove a device-authorization record by ID across the component boundary. */
export async function mutateDeviceRemove(ctx: ComponentCallCtx, deviceId: string): Promise<void> {
  await ctx.runMutation(ctx.auth.config.component.factor.device.remove, {
    id: deviceId,
  });
}
