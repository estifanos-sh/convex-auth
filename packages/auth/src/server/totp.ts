/**
 * Server-side TOTP ceremony logic for two-factor authentication.
 *
 * Two single-word flows:
 *
 * - `setup`  — generate a TOTP secret and `otpauth://` URI for enrollment.
 * - `verify` — consume a TOTP code. Auto-detects:
 *     - first-time enrollment confirmation (caller passes `totpId`), or
 *     - 2FA sign-in challenge (no `totpId`).
 */

import {
  decodeBase64urlIgnorePadding,
  encodeBase32LowerCaseNoPadding,
  encodeBase64urlNoPadding,
} from "@oslojs/encoding";
import { createTOTPKeyURI, verifyTOTPWithGracePeriod } from "@oslojs/otp";
import { ConvexError, GenericId } from "convex/values";

import { ErrorCode } from "../shared/codes";
import { authFlowError } from "../shared/errors";
import type { AuthTokens, SignInSessionResult, SignInTotpSetupResult } from "../shared/results";
import type { AuthErrorData } from "./errors";
import { toConvexError } from "./errors";
import { queueAuthEvent } from "./events";
import { getAuthenticatedUserIdOrNull } from "./identity/claims";
import { maxSignInAttempts } from "./limits";
import { decryptSecret, encryptSecret } from "./secret";
import {
  buildSessionIdentity,
  finalizeSessionIssuance,
  getAuthSessionId,
  sessionExpirationTime,
} from "./session/lifecycle";
import { encodeRefreshToken, refreshTokenExpirationTime } from "./token/refresh";
import { buildKnownSignInIdentityAttributes } from "./telemetry";
import {
  AuthDataModel,
  type CrossComponentUserDoc,
  GenericActionCtxWithAuthConfig,
  SessionInfo,
  TotpProviderConfig,
} from "./types";
import { setActiveSpanAttributes } from "./utils/span";

type EnrichedActionCtx = GenericActionCtxWithAuthConfig<AuthDataModel>;

type TotpResult =
  | SignInSessionResult<SessionInfo<AuthTokens | null> | null>
  | SignInTotpSetupResult;

const TOTP_FLOWS = { setup: true, verify: true } as const;

type TotpFlow = keyof typeof TOTP_FLOWS;

function isTotpFlow(value: unknown): value is TotpFlow {
  return typeof value === "string" && Object.hasOwn(TOTP_FLOWS, value);
}

type TotpDispatch =
  | { flow: "setup"; params: Record<string, unknown> }
  /** Enrollment confirmation — `totpId` distinguishes from a 2FA challenge. */
  | { flow: "verify"; code: string; verifier: string; totpId: string; intent: "enrollment" }
  /** 2FA challenge during sign-in. */
  | { flow: "verify"; code: string; verifier: string; totpId?: undefined; intent: "challenge" };

const convexError = (code: ErrorCode, message: string) =>
  toConvexError(authFlowError(code, message));

const asConvexError = (
  error: unknown,
  code: ErrorCode,
  message: string,
): ConvexError<AuthErrorData> =>
  error instanceof ConvexError
    ? error
    : error instanceof Error
      ? toConvexError(authFlowError(code, error.message || message))
      : convexError(code, message);

/**
 * Encrypt a raw TOTP secret for storage. The secret bytes are base64url-encoded
 * and sealed with the server's {@link encryptSecret} (AES-GCM); the resulting
 * ciphertext string is stored UTF-8-encoded in the `TotpFactor.secret` bytes
 * field. Runs server-side because component functions cannot read
 * the secret-encryption key from `AUTH_KEYS`.
 */
async function encryptTotpSecret(secret: Uint8Array): Promise<ArrayBuffer> {
  const ciphertext = await encryptSecret(encodeBase64urlNoPadding(secret));
  const encoded = new TextEncoder().encode(ciphertext);
  return encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;
}

/**
 * Reverse {@link encryptTotpSecret}: decode the stored ciphertext bytes, decrypt
 * to the base64url secret, and return the raw secret bytes for verification.
 */
async function decryptTotpSecret(stored: ArrayBuffer): Promise<Uint8Array> {
  const ciphertext = new TextDecoder().decode(stored);
  const secretB64 = await decryptSecret(ciphertext);
  return decodeBase64urlIgnorePadding(secretB64);
}

function resolveTotpFlow(params: Record<string, unknown>): TotpFlow {
  const flow = params.flow;
  if (isTotpFlow(flow)) {
    return flow;
  }
  throw convexError(
    ErrorCode.TOTP_MISSING_FLOW,
    "Missing `flow` parameter. Expected one of: " + Object.keys(TOTP_FLOWS).join(", "),
  );
}

function requireTotpVerifier(verifier: string | undefined): string {
  if (verifier != null) {
    return verifier;
  }
  throw convexError(ErrorCode.TOTP_MISSING_VERIFIER, "Missing verifier for TOTP operation.");
}

function requireTotpCode(params: Record<string, unknown>): string {
  if (typeof params.code === "string") {
    return params.code;
  }
  throw convexError(ErrorCode.TOTP_MISSING_CODE, "Missing TOTP code.");
}

function resolveTotpDispatch(
  params: Record<string, unknown>,
  verifier: string | undefined,
): TotpDispatch {
  const flow = resolveTotpFlow(params);
  if (flow === "setup") {
    return { flow, params };
  }
  const resolvedVerifier = requireTotpVerifier(verifier);
  const code = requireTotpCode(params);
  if (typeof params.totpId === "string" && params.totpId.length > 0) {
    return {
      flow,
      code,
      totpId: params.totpId,
      verifier: resolvedVerifier,
      intent: "enrollment",
    };
  }
  return {
    flow,
    code,
    verifier: resolvedVerifier,
    intent: "challenge",
  };
}

async function requireAuthenticatedUserId(ctx: EnrichedActionCtx): Promise<string> {
  try {
    const userId = await getAuthenticatedUserIdOrNull(ctx);
    if (userId === null) {
      throw convexError(
        ErrorCode.TOTP_AUTH_REQUIRED,
        "Sign in first, then set up two-factor authentication.",
      );
    }
    return userId;
  } catch (error) {
    if (error instanceof ConvexError) {
      throw error;
    }
    throw asConvexError(error, ErrorCode.INTERNAL_ERROR, String(error));
  }
}

/**
 * Drive the TOTP provider's `setup` / `verify` flow.
 *
 * `setup` issues an enrollment secret and `otpauth://` URI; `verify` either
 * confirms a first-time enrollment (when `params.totpId` is present) or
 * completes a 2FA challenge during sign-in.
 *
 * @internal
 */
export const handleTotp = async (
  ctx: EnrichedActionCtx,
  provider: TotpProviderConfig,
  args: { params?: Record<string, unknown>; verifier?: string },
): Promise<TotpResult> => {
  const params = args.params ?? {};
  const dispatch = resolveTotpDispatch(params, args.verifier);

  async function setup(setupParams: Record<string, unknown>): Promise<TotpResult> {
    const userId = await requireAuthenticatedUserId(ctx);
    const secret = new Uint8Array(20);
    crypto.getRandomValues(secret);
    const base32Secret = encodeBase32LowerCaseNoPadding(secret);
    let enrollment: { user: CrossComponentUserDoc; totpId: string; verifierId: string };
    try {
      enrollment = (await ctx.runMutation(ctx.auth.config.component.factor.totp.createEnrollment, {
        userId,
        secret: await encryptTotpSecret(secret),
        digits: provider.options.digits,
        period: provider.options.period,
        name: typeof setupParams.name === "string" ? setupParams.name : undefined,
        createdAt: Date.now(),
      })) as typeof enrollment;
    } catch (error) {
      throw asConvexError(error, ErrorCode.INTERNAL_ERROR, `TOTP setup failed: ${String(error)}`);
    }
    const accountName =
      typeof setupParams.accountName === "string" && setupParams.accountName.length > 0
        ? setupParams.accountName
        : (enrollment.user.email ?? "user");
    const uri = createTOTPKeyURI(
      provider.options.issuer,
      accountName,
      secret,
      provider.options.period,
      provider.options.digits,
    );

    return {
      kind: "totpSetup" as const,
      totpSetup: { uri, secret: base32Secret, totpId: enrollment.totpId },
      verifier: enrollment.verifierId,
    };
  }

  /**
   * `verify` with `totpId`: completes a first-time enrollment after `setup`.
   * Marks the TOTP factor as verified and signs the user in.
   */
  async function confirmEnrollment(
    code: string,
    totpId: string,
    verifier: string,
  ): Promise<TotpResult> {
    const userId = await requireAuthenticatedUserId(ctx);
    const result = await verifyTotp({
      code,
      verifier,
      intent: "enrollment",
      authenticatedUserId: userId,
      totpId,
    });
    await queueAuthEvent(ctx, ctx.auth.config, {
      kind: "totp.enrolled",
      actor: { type: "user", id: userId },
      subject: { type: "totp", id: totpId },
      targets: [{ kind: "user", id: userId }],
      outcome: "success",
      data: { totpId },
    });
    return result;
  }

  /**
   * `verify` without `totpId`: completes a 2FA challenge during sign-in.
   * Looks up the user's verified TOTP factor, validates the code, signs in.
   */
  async function verifyChallenge(code: string, verifier: string): Promise<TotpResult> {
    return await verifyTotp({ code, verifier, intent: "challenge" });
  }

  async function verifyTotp(input: {
    code: string;
    verifier: string;
    intent: "enrollment" | "challenge";
    authenticatedUserId?: string;
    totpId?: string;
  }): Promise<TotpResult> {
    const begun = (await ctx.runMutation(ctx.auth.config.component.factor.totp.beginVerification, {
      verifierId: input.verifier,
      intent: input.intent,
      authenticatedUserId: input.authenticatedUserId,
      totpId: input.totpId,
      maxAttemptsPerHour: maxSignInAttempts(ctx.auth.config),
    })) as
      | { status: "invalid_verifier" | "limited" | "not_found" | "already_verified" }
      | {
          status: "ready";
          userId: string;
          factor: {
            _id: string;
            secret: ArrayBuffer;
            period: number;
            digits: number;
          };
        };

    if (begun.status === "invalid_verifier") {
      throw convexError(ErrorCode.TOTP_INVALID_VERIFIER, "Invalid or expired TOTP verifier.");
    }
    if (begun.status === "limited") {
      throw convexError(ErrorCode.RATE_LIMITED, "Too many TOTP attempts. Try again later.");
    }
    if (begun.status === "already_verified") {
      throw convexError(ErrorCode.TOTP_ALREADY_VERIFIED, "TOTP enrollment is already verified.");
    }
    if (begun.status === "not_found") {
      throw convexError(
        input.intent === "enrollment" ? ErrorCode.TOTP_NOT_FOUND : ErrorCode.TOTP_NO_ENROLLMENT,
        input.intent === "enrollment"
          ? "TOTP enrollment not found."
          : "No verified TOTP enrollment found.",
      );
    }
    if (begun.status !== "ready") {
      throw convexError(ErrorCode.INTERNAL_ERROR, "Unexpected TOTP verification state.");
    }

    const secret = await decryptTotpSecret(begun.factor.secret);
    if (
      !verifyTOTPWithGracePeriod(secret, begun.factor.period, begun.factor.digits, input.code, 30)
    ) {
      throw convexError(ErrorCode.TOTP_INVALID_CODE, "Invalid TOTP code.");
    }

    const replaceSessionId = (await getAuthSessionId(ctx)) ?? undefined;
    const completed = (await ctx.runMutation(
      ctx.auth.config.component.factor.totp.completeVerification,
      {
        verifierId: input.verifier,
        intent: input.intent,
        authenticatedUserId: input.authenticatedUserId,
        totpId: input.totpId,
        replaceSessionId,
        sessionExpirationTime: sessionExpirationTime(ctx.auth.config),
        refreshTokenExpirationTime: refreshTokenExpirationTime(ctx.auth.config),
        now: Date.now(),
      },
    )) as
      | { status: "rejected" }
      | {
          status: "accepted";
          user: CrossComponentUserDoc;
          factorId: string;
          sessionId: string;
          refreshTokenId: string;
          replacedSessionId?: string;
        };
    if (completed.status !== "accepted") {
      throw convexError(ErrorCode.TOTP_INVALID_VERIFIER, "Invalid or expired TOTP verifier.");
    }

    const userId = completed.user._id as GenericId<"User">;
    const sessionId = completed.sessionId as GenericId<"Session">;
    setActiveSpanAttributes({
      "auth.signin.result": "success",
      ...buildKnownSignInIdentityAttributes(
        ctx.auth.config,
        { userId, sessionId },
        completed.user.email,
      ),
    });
    if (completed.replacedSessionId !== undefined) {
      const replacedSessionId = completed.replacedSessionId as GenericId<"Session">;
      await queueAuthEvent(ctx, ctx.auth.config, {
        kind: "session.invalidated",
        actor: { type: "system" },
        subject: { type: "session", id: replacedSessionId },
        targets: [
          { kind: "user", id: userId },
          { kind: "session", id: replacedSessionId },
        ],
        outcome: "success",
        data: { userId, reason: "replaced" },
      });
    }
    await queueAuthEvent(ctx, ctx.auth.config, {
      kind: "session.signed_in",
      actor: { type: "user", id: userId },
      subject: { type: "session", id: sessionId },
      targets: [
        { kind: "user", id: userId },
        { kind: "session", id: sessionId },
      ],
      outcome: "success",
      data: { provider: "session", method: provider.id },
    });
    const session = await finalizeSessionIssuance(ctx.auth.config, {
      userId,
      sessionId,
      identity: buildSessionIdentity(userId, sessionId, completed.user),
      refreshToken: encodeRefreshToken(
        completed.refreshTokenId as GenericId<"RefreshToken">,
        sessionId,
      ),
    });
    return { kind: "signedIn" as const, session };
  }

  if (dispatch.flow === "setup") {
    return await setup(dispatch.params);
  }
  if (dispatch.intent === "enrollment") {
    return await confirmEnrollment(dispatch.code, dispatch.totpId, dispatch.verifier);
  }
  return await verifyChallenge(dispatch.code, dispatch.verifier);
};
