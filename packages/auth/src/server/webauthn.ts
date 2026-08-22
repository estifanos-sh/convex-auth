/**
 * Server-side WebAuthn ceremony logic.
 *
 * Handles the four phases of the WebAuthn flow:
 * 1. registerOptions — generate PublicKeyCredentialCreationOptions
 * 2. registerVerify — verify attestation and store credential
 * 3. authOptions — generate PublicKeyCredentialRequestOptions
 * 4. authVerify — verify assertion signature and sign in
 *
 * Uses `@oslojs/webauthn` for attestation/assertion parsing and
 * `@oslojs/crypto` for signature verification.
 *
 * @module
 */

import {
  decodePKIXECDSASignature,
  decodeSEC1PublicKey,
  p256,
  verifyECDSASignature,
} from "@oslojs/crypto/ecdsa";
import {
  decodePKCS1RSAPublicKey,
  RSAPublicKey,
  sha256ObjectIdentifier,
  verifyRSASSAPKCS1v15Signature,
} from "@oslojs/crypto/rsa";
import { decodeCBORToNativeValueNoLeftoverBytes } from "@oslojs/cbor";
import { sha256 } from "@oslojs/crypto/sha2";
import { decodeBase64urlIgnorePadding, encodeBase64urlNoPadding } from "@oslojs/encoding";
import {
  ClientDataType,
  coseAlgorithmES256,
  coseAlgorithmRS256,
  COSEKeyType,
  createAssertionSignatureMessage,
  parseAttestationObject,
  parseAuthenticatorData,
  parseClientDataJSON,
} from "@oslojs/webauthn";

import type {
  AuthTokens,
  SignInWebAuthnOptionsResult,
  SignInSessionResult,
} from "../shared/results";
import { ConvexError, type GenericId } from "convex/values";

import { ErrorCode } from "../shared/codes";
import {
  MAX_WEBAUTHN_CREDENTIAL_ID_LENGTH,
  MAX_WEBAUTHN_CREDENTIALS_PER_USER,
} from "../shared/webauthn";
import { authFlowError } from "../shared/errors";
import { requireAuthKey } from "./env";
import type { AuthErrorData } from "./errors";
import { toConvexError } from "./errors";
import { queueAuthEvent } from "./events";
import { getAuthenticatedUserIdOrNull } from "./identity/claims";
import { LOG_LEVELS, log } from "./log";
import {
  consumeVerifierById,
  mutatePasskeyBeginRotation,
  mutatePasskeyBeginAssertion,
  mutatePasskeyBeginRegistration,
  mutatePasskeyBeginSignIn,
  mutatePasskeyCompleteAssertion,
  mutatePasskeyCompleteRegistration,
  mutatePasskeyCompleteRotation,
  queryContinuation,
} from "./component/factor/db";
import {
  buildSessionIdentity,
  finalizeSessionIssuance,
  getAuthSessionId,
  getAuthSessionReplacement,
  sessionExpirationTime,
} from "./session/lifecycle";
import { encodeRefreshToken, refreshTokenExpirationTime } from "./token/refresh";
import { buildKnownSignInIdentityAttributes } from "./telemetry";
import {
  AuthDataModel,
  GenericActionCtxWithAuthConfig,
  WebAuthnAttestationEvidence,
  WebAuthnAttestationPolicy,
  WebAuthnProviderConfig,
  SessionInfo,
} from "./types";
import { appUrlFromEnv } from "./url";
import { setActiveSpanAttributes } from "./utils/span";
import { callCompleteCredentialEnrollment } from "./mutations/calls";

type EnrichedActionCtx = GenericActionCtxWithAuthConfig<AuthDataModel>;

interface RpOptions {
  rpName: string;
  rpId: string;
  origin: string | string[];
  challengeExpirationMs: number;
  registration: WebAuthnProviderConfig["options"]["registration"];
  authentication: WebAuthnProviderConfig["options"]["authentication"];
}

type WebAuthnResult =
  | SignInSessionResult<SessionInfo<AuthTokens | null> | null>
  | SignInWebAuthnOptionsResult;

type PasskeyRegistrationData = Omit<
  Parameters<typeof mutatePasskeyCompleteRegistration>[1],
  "replaceSession"
>;

type PasskeyRegistrationBase = Omit<PasskeyRegistrationData, "userId">;

type PasskeySessionCompletion = Pick<
  Awaited<ReturnType<typeof mutatePasskeyCompleteRegistration>>,
  "user" | "sessionId" | "sessionExpirationTime" | "refreshTokenId" | "replacedSessionId"
>;

/**
 * The WebAuthn provider has three single-word flows:
 *
 * - `register` — issue a WebAuthn registration challenge (phase 1).
 * - `signIn`   — issue a WebAuthn authentication challenge (phase 1).
 * - `verify`   — consume the WebAuthn response (phase 2). The server
 *                auto-detects whether this completes a registration
 *                (`attestationObject` present) or a sign-in
 *                (`signature` + `credentialId` present).
 */
const WEBAUTHN_FLOWS = ["register", "signIn", "verify"] as const;
type WebAuthnFlow = (typeof WEBAUTHN_FLOWS)[number];
type WebAuthnDispatch = { flow: WebAuthnFlow };

function isWebAuthnFlow(value: string): value is WebAuthnFlow {
  return WEBAUTHN_FLOWS.some((flow) => flow === value);
}

type PasskeyParams = {
  flow?: string;
  userName?: string;
  userDisplayName?: string;
  email?: string;
  clientDataJSON?: string;
  attestationObject?: string;
  transports?: string[];
  passkeyName?: string;
  credentialId?: string;
  authenticatorData?: string;
  signature?: string;
};

type PasskeyParamCandidate = {
  flow?: unknown;
  userName?: unknown;
  userDisplayName?: unknown;
  email?: unknown;
  clientDataJSON?: unknown;
  attestationObject?: unknown;
  transports?: unknown;
  passkeyName?: unknown;
  credentialId?: unknown;
  authenticatorData?: unknown;
  signature?: unknown;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parsePasskeyParams(value: unknown): PasskeyParams {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const input = value as PasskeyParamCandidate;
  const string = (key: keyof PasskeyParams) => {
    const candidate = input[key];
    return typeof candidate === "string" ? candidate : undefined;
  };
  const transports = isStringArray(input.transports) ? input.transports : undefined;
  return {
    flow: string("flow"),
    userName: string("userName"),
    userDisplayName: string("userDisplayName"),
    email: string("email"),
    clientDataJSON: string("clientDataJSON"),
    attestationObject: string("attestationObject"),
    transports,
    passkeyName: string("passkeyName"),
    credentialId: string("credentialId"),
    authenticatorData: string("authenticatorData"),
    signature: string("signature"),
  };
}

const requireStringParam = (value: unknown, name: string) => {
  if (typeof value !== "string") {
    throw convexError(ErrorCode.INVALID_PARAMETERS, `Missing \`${name}\` parameter.`);
  }
  return value;
};

const convexError = (code: ErrorCode, message: string) =>
  toConvexError(authFlowError(code, message));

const MAX_ENCODED_WEBAUTHN_CREDENTIAL_ID_LENGTH = Math.ceil(
  (MAX_WEBAUTHN_CREDENTIAL_ID_LENGTH * 4) / 3,
);

/** @internal */
export function validateCredentialId(value: unknown): string {
  const credentialId = requireStringParam(value, "credentialId");
  if (
    credentialId.length === 0 ||
    credentialId.length > MAX_ENCODED_WEBAUTHN_CREDENTIAL_ID_LENGTH
  ) {
    throw convexError(
      ErrorCode.PASSKEY_INVALID_CLIENT_DATA,
      `Credential ID must be between 1 and ${MAX_WEBAUTHN_CREDENTIAL_ID_LENGTH} bytes.`,
    );
  }
  if (!/^[A-Za-z0-9_-]+$/.test(credentialId)) {
    throw convexError(
      ErrorCode.PASSKEY_INVALID_CLIENT_DATA,
      "Credential ID must be valid unpadded base64url.",
    );
  }

  let decoded: Uint8Array;
  try {
    decoded = decodeBase64urlIgnorePadding(credentialId);
  } catch {
    throw convexError(
      ErrorCode.PASSKEY_INVALID_CLIENT_DATA,
      "Credential ID must be valid unpadded base64url.",
    );
  }
  if (decoded.byteLength < 1 || decoded.byteLength > MAX_WEBAUTHN_CREDENTIAL_ID_LENGTH) {
    throw convexError(
      ErrorCode.PASSKEY_INVALID_CLIENT_DATA,
      `Credential ID must be between 1 and ${MAX_WEBAUTHN_CREDENTIAL_ID_LENGTH} bytes.`,
    );
  }
  return credentialId;
}

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

const logPasskeyError = (err: unknown) =>
  log(LOG_LEVELS.ERROR, "passkey error:", err instanceof Error ? err.message : String(err));

function resolveRpOptions(provider: WebAuthnProviderConfig): RpOptions {
  try {
    let appUrl: string | undefined;
    if (provider.options.rpId === undefined || provider.options.origin === undefined) {
      try {
        appUrl = appUrlFromEnv();
      } catch {
        throw convexError(
          ErrorCode.PASSKEY_MISSING_CONFIG,
          "Passkey provider requires APP_URL env var (your frontend URL) or explicit rpId and origin in the provider config. CONVEX_SITE_URL cannot be used because WebAuthn RP ID must match the frontend domain.",
        );
      }
    }

    const appHostname = appUrl ? new URL(appUrl).hostname : undefined;
    const registration: RpOptions["registration"] = {
      userVerification: provider.options.registration.userVerification ?? "required",
      residentKey: provider.options.registration.residentKey ?? "preferred",
      algorithms: provider.options.registration.algorithms ?? [
        coseAlgorithmES256,
        coseAlgorithmRS256,
      ],
    };
    const authentication: RpOptions["authentication"] = {
      userVerification: provider.options.authentication.userVerification ?? "required",
    };
    if (provider.options.registration.authenticatorAttachment !== undefined) {
      registration.authenticatorAttachment = provider.options.registration.authenticatorAttachment;
    }
    if (provider.options.registration.hints !== undefined) {
      registration.hints = provider.options.registration.hints;
    }
    if (provider.options.registration.attestation !== undefined) {
      registration.attestation = provider.options.registration.attestation;
    }
    if (provider.options.authentication.hints !== undefined) {
      authentication.hints = provider.options.authentication.hints;
    }
    return {
      rpName: provider.options.rpName ?? appHostname ?? provider.options.rpId ?? "localhost",
      rpId: provider.options.rpId ?? appHostname ?? "localhost",
      origin: provider.options.origin ?? appUrl ?? "http://localhost",
      challengeExpirationMs: provider.options.challengeExpirationMs ?? 300_000,
      registration,
      authentication,
    };
  } catch (error) {
    throw asConvexError(
      error,
      ErrorCode.PASSKEY_MISSING_CONFIG,
      "Passkey relying party configuration is invalid.",
    );
  }
}

function verifySameOrigin<T extends { crossOrigin: boolean | null }>(clientData: T): T {
  if (clientData.crossOrigin === true) {
    throw convexError(
      ErrorCode.PASSKEY_INVALID_CLIENT_DATA,
      "Cross-origin WebAuthn ceremonies are not supported.",
    );
  }
  return clientData;
}

function verifyClientDataType<T extends { type: ClientDataType }>(
  clientData: T,
  expectedType: ClientDataType,
  label: string,
): T {
  if (clientData.type !== expectedType) {
    throw convexError(
      ErrorCode.PASSKEY_INVALID_CLIENT_DATA,
      `Invalid client data type: expected ${label}`,
    );
  }
  return clientData;
}

function verifyOrigin<T extends { origin: string }>(clientData: T, rp: RpOptions): T {
  const allowed = Array.isArray(rp.origin) ? rp.origin : [rp.origin];
  if (!allowed.includes(clientData.origin)) {
    throw convexError(
      ErrorCode.PASSKEY_INVALID_ORIGIN,
      `Invalid origin: ${clientData.origin}, expected one of: ${allowed.join(", ")}`,
    );
  }
  return clientData;
}

async function verifyAndConsumeChallenge<T extends { challenge: Uint8Array }>(
  clientData: T,
  ctx: EnrichedActionCtx,
  verifierValue: string,
) {
  const challengeHash = encodeBase64urlNoPadding(new Uint8Array(sha256(clientData.challenge)));
  // Read-check-delete the challenge verifier in ONE component mutation: this runs
  // in an action, so a separate `get` then `remove` let two concurrent
  // assertions carrying the same challenge both pass before either delete landed,
  // each minting its own session. `consume` matches the expected challenge hash
  // and deletes atomically, so only the single winner gets the doc back.
  let doc;
  try {
    doc = await consumeVerifierById(ctx, verifierValue, challengeHash);
  } catch (err) {
    console.error("[auth] passkey error:", err);
    throw convexError(ErrorCode.PASSKEY_INVALID_CHALLENGE, "Invalid or expired passkey challenge.");
  }
  if (!doc) {
    throw convexError(ErrorCode.PASSKEY_INVALID_CHALLENGE, "Invalid or expired passkey challenge.");
  }
  return doc;
}

function verifyRpId<T extends { verifyRelyingPartyIdHash: (id: string) => boolean }>(
  authData: T,
  rpId: string,
): T {
  if (!authData.verifyRelyingPartyIdHash(rpId)) {
    throw convexError(ErrorCode.PASSKEY_RP_MISMATCH, "Relying party ID mismatch.");
  }
  return authData;
}

function verifyUserFlags<T extends { userPresent: boolean; userVerified: boolean }>(
  authData: T,
  userVerification: "required" | "preferred" | "discouraged",
): T {
  if (!authData.userPresent) {
    throw convexError(ErrorCode.PASSKEY_USER_PRESENCE, "User presence flag not set.");
  }
  if (userVerification === "required" && !authData.userVerified) {
    throw convexError(
      ErrorCode.PASSKEY_USER_VERIFICATION,
      "User verification required but not performed.",
    );
  }
  return authData;
}

type BackupState = {
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
};

/** @internal */
export function parseBackupState(authenticatorData: Uint8Array): BackupState {
  if (authenticatorData.byteLength < 33) {
    throw convexError(ErrorCode.PASSKEY_INVALID_CLIENT_DATA, "Authenticator data is too short.");
  }
  const flags = authenticatorData[32];
  const backupEligible = (flags & 0x08) !== 0;
  const backedUp = (flags & 0x10) !== 0;
  if (backedUp && !backupEligible) {
    throw convexError(
      ErrorCode.PASSKEY_INVALID_CLIENT_DATA,
      "Authenticator backup state is invalid.",
    );
  }
  return {
    deviceType: backupEligible ? "multiDevice" : "singleDevice",
    backedUp,
  };
}

function extractAttestationAuthenticatorData(attestationObject: Uint8Array): Uint8Array {
  try {
    const decoded = decodeCBORToNativeValueNoLeftoverBytes(attestationObject, 4);
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("authData" in decoded) ||
      !(decoded.authData instanceof Uint8Array)
    ) {
      throw new Error("Invalid or missing authData");
    }
    return decoded.authData;
  } catch (error) {
    throw asConvexError(
      error,
      ErrorCode.PASSKEY_INVALID_CLIENT_DATA,
      "Invalid attestation authenticator data.",
    );
  }
}

/** @internal */
export function validateCredentialAlgorithm(
  algorithm: number,
  configuredAlgorithms: readonly number[],
): void {
  if (!configuredAlgorithms.includes(algorithm)) {
    throw convexError(
      ErrorCode.PASSKEY_UNSUPPORTED_ALGORITHM,
      `Credential algorithm ${algorithm} was not offered by the server.`,
    );
  }
}

function resolveWebAuthnDispatch(params: PasskeyParams): WebAuthnDispatch {
  const flow = params.flow;
  if (typeof flow === "string" && isWebAuthnFlow(flow)) {
    return { flow };
  }
  throw convexError(
    ErrorCode.PASSKEY_MISSING_FLOW,
    "Missing `flow` parameter. Expected one of: " + WEBAUTHN_FLOWS.join(", "),
  );
}

function requirePasskeyVerifier(verifier: string | undefined): string {
  if (verifier != null) {
    return verifier;
  }
  throw convexError(ErrorCode.PASSKEY_MISSING_VERIFIER, "Missing verifier for passkey operation.");
}

async function requireAuthenticatedUserId(ctx: EnrichedActionCtx): Promise<string> {
  try {
    const userId = await getAuthenticatedUserIdOrNull(ctx);
    if (userId === null) {
      throw convexError(
        ErrorCode.PASSKEY_AUTH_REQUIRED,
        "Sign in first, then add a passkey to your account.",
      );
    }
    return userId;
  } catch (err) {
    console.error("[auth] passkey error:", err);
    throw convexError(
      ErrorCode.PASSKEY_AUTH_REQUIRED,
      "Sign in first, then add a passkey to your account.",
    );
  }
}

function resolveRegistrationPublicKeyBytes(
  publicKey: NonNullable<
    ReturnType<typeof parseAttestationObject>["authenticatorData"]["credential"]
  >["publicKey"],
  algorithm: number,
): Uint8Array {
  if (algorithm === coseAlgorithmES256) {
    const ec2 = publicKey.ec2();
    const xBytes = new Uint8Array(32);
    let vx = ec2.x;
    for (let i = 31; i >= 0; i--) {
      xBytes[i] = Number(vx & 0xffn);
      vx >>= 8n;
    }
    const yBytes = new Uint8Array(32);
    let vy = ec2.y;
    for (let i = 31; i >= 0; i--) {
      yBytes[i] = Number(vy & 0xffn);
      vy >>= 8n;
    }
    const bytes = new Uint8Array(65);
    bytes[0] = 0x04;
    bytes.set(xBytes, 1);
    bytes.set(yBytes, 33);
    return bytes;
  }
  if (algorithm === coseAlgorithmRS256) {
    const rsa = publicKey.rsa();
    const rsaPubKey = new RSAPublicKey(rsa.n, rsa.e);
    return rsaPubKey.encodePKCS1();
  }
  throw convexError(ErrorCode.PASSKEY_UNSUPPORTED_ALGORITHM, `Unsupported algorithm: ${algorithm}`);
}

function verifyAssertionSignature(
  passkey: { algorithm: number; publicKey: ArrayBuffer },
  signature: Uint8Array,
  messageHash: Uint8Array,
): void {
  try {
    if (passkey.algorithm === coseAlgorithmES256) {
      const ecPublicKey = decodeSEC1PublicKey(p256, new Uint8Array(passkey.publicKey));
      const ecdsaSignature = decodePKIXECDSASignature(signature);
      if (!verifyECDSASignature(ecPublicKey, messageHash, ecdsaSignature)) {
        throw convexError(ErrorCode.PASSKEY_INVALID_SIGNATURE, "Invalid passkey signature.");
      }
      return;
    }
    if (passkey.algorithm === coseAlgorithmRS256) {
      const rsaPublicKey = decodePKCS1RSAPublicKey(new Uint8Array(passkey.publicKey));
      if (
        !verifyRSASSAPKCS1v15Signature(rsaPublicKey, sha256ObjectIdentifier, messageHash, signature)
      ) {
        throw convexError(ErrorCode.PASSKEY_INVALID_SIGNATURE, "Invalid passkey signature.");
      }
      return;
    }
    throw convexError(
      ErrorCode.PASSKEY_UNSUPPORTED_ALGORITHM,
      `Unsupported algorithm: ${passkey.algorithm}`,
    );
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    throw convexError(ErrorCode.PASSKEY_INVALID_SIGNATURE, "Invalid passkey signature.");
  }
}

const DUMMY_ES256_PUBLIC_KEY = decodeBase64urlIgnorePadding(
  "BGsX0fLhLEJH-Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU",
);
const DUMMY_RS256_PUBLIC_KEY = decodeBase64urlIgnorePadding(
  "MIIBCgKCAQEAxumpcTeR9zlJNbNZinnjj_eb75YcIeNHf92QdRZ86g_wGzz6WW4VmpRSrkMJC1u3EYdN7rRSw1tveNaw7g6NTfaLjJdyrxkpNdx6niAXq8dMHGe5-Y9MyoGNwP0T_c6PrBdu_M-xGEtpDIG9GwNCM9RHsOxcf7PxVaHBZqR_BoWWLTHrVw6weXBYALsp3iz-jFDl5mG7JW9G_sKVr9dV0BAzeNMAKJEAoEO4swJB4qWGhHaSzCyy8YMngsuQrO9L5L_m8dG0GjYjjkV1G2aoRIl8VR7nnJdGFaAlSgqO_icJN6QY3WS2aalDEr1yRx2mjJPRUIr6rZMCfsuyjq1NZwIDAQAB",
);

type AssertionCredential = { algorithm: number; publicKey: ArrayBuffer };

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function registrationData(
  credentialId: string,
  publicKey: Uint8Array,
  algorithm: number,
  counter: number,
  backupState: BackupState,
  params: PasskeyParams,
  attestation: WebAuthnAttestationEvidence | undefined,
  ctx: EnrichedActionCtx,
): PasskeyRegistrationBase {
  return {
    credentialId,
    publicKey: copyArrayBuffer(publicKey),
    algorithm,
    counter,
    ...(params.transports === undefined ? {} : { transports: params.transports }),
    deviceType: backupState.deviceType,
    backedUp: backupState.backedUp,
    ...(params.passkeyName === undefined ? {} : { name: params.passkeyName }),
    ...(attestation === undefined ? {} : { attestation }),
    createdAt: Date.now(),
    sessionExpirationTime: sessionExpirationTime(ctx.auth.config),
    refreshTokenExpirationTime: refreshTokenExpirationTime(ctx.auth.config),
  };
}

async function finalizePasskeySession(
  ctx: EnrichedActionCtx,
  completed: PasskeySessionCompletion,
): Promise<SignInSessionResult<SessionInfo<AuthTokens | null> | null>> {
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
    data: { provider: "session" },
  });
  const session = await finalizeSessionIssuance(ctx.auth.config, {
    userId,
    sessionId,
    sessionExpirationTime: completed.sessionExpirationTime,
    identity: buildSessionIdentity(userId, sessionId, completed.user),
    refreshToken: encodeRefreshToken(
      completed.refreshTokenId as GenericId<"RefreshToken">,
      sessionId,
    ),
  });
  return { kind: "signedIn", session };
}

function signatureIsValid(
  credential: AssertionCredential,
  signature: Uint8Array,
  messageHash: Uint8Array,
): boolean {
  try {
    verifyAssertionSignature(credential, signature, messageHash);
    return true;
  } catch {
    return false;
  }
}

/**
 * Perform both supported verification algorithms for real and unknown IDs so
 * the selected algorithm is not a credential-existence timing oracle.
 */
function verifyAssertionSignatureUniformly(
  passkey: AssertionCredential | null,
  signature: Uint8Array,
  messageHash: Uint8Array,
): asserts passkey is AssertionCredential {
  const es256Valid = signatureIsValid(
    passkey?.algorithm === coseAlgorithmES256
      ? passkey
      : {
          algorithm: coseAlgorithmES256,
          publicKey: copyArrayBuffer(DUMMY_ES256_PUBLIC_KEY),
        },
    signature,
    messageHash,
  );
  const rs256Valid = signatureIsValid(
    passkey?.algorithm === coseAlgorithmRS256
      ? passkey
      : {
          algorithm: coseAlgorithmRS256,
          publicKey: copyArrayBuffer(DUMMY_RS256_PUBLIC_KEY),
        },
    signature,
    messageHash,
  );
  const valid =
    passkey?.algorithm === coseAlgorithmES256
      ? es256Valid
      : passkey?.algorithm === coseAlgorithmRS256
        ? rs256Valid
        : false;
  if (!valid) {
    throw convexError(ErrorCode.PASSKEY_INVALID_SIGNATURE, "Invalid passkey signature.");
  }
}

/** @internal */
export function validateBackupEligibility(
  storedDeviceType: string,
  assertionDeviceType: BackupState["deviceType"],
): void {
  if (storedDeviceType !== assertionDeviceType) {
    throw convexError(
      ErrorCode.PASSKEY_INVALID_CLIENT_DATA,
      "Authenticator backup eligibility changed for an existing credential.",
    );
  }
}

/** @internal */
export async function assertStoredAttestationTrusted(
  policy: WebAuthnAttestationPolicy,
  evidence: WebAuthnAttestationEvidence | undefined,
): Promise<void> {
  if (!evidence) {
    throw convexError(
      ErrorCode.PASSKEY_UNTRUSTED_ATTESTATION,
      "This credential predates the current attestation policy and must be registered again.",
    );
  }
  try {
    await policy.verifier.assertTrusted(evidence);
  } catch (error) {
    throw asConvexError(
      error,
      ErrorCode.PASSKEY_UNTRUSTED_ATTESTATION,
      "Authenticator attestation is no longer trusted.",
    );
  }
}

/**
 * Build a constant-size, secret-keyed `allowCredentials` list for an email-first
 * sign-in. Real credential IDs are mixed with deterministic decoys, then are
 * ordered by a secret-keyed digest.
 *
 * A known email with passkeys returns a populated `allowCredentials`, so an
 * absent/empty list for every other email would be an immediate
 * account-enumeration oracle. Padding keeps the top-level shape and pair
 * multiplicities equivalent and prevents public prediction of decoy IDs.
 *
 * Credential IDs are authenticator-generated and variable-length. A bounded
 * allow-list cannot make every possible real length statistically identical to
 * an unknown account, so this is defense in depth rather than a claim of
 * identifier privacy. Prefer discoverable credentials and email-less sign-in
 * when account-enumeration resistance is a hard requirement.
 *
 * Decoy IDs reference no stored credential: the ceremony simply fails to produce
 * an assertion (as it would for a real account whose authenticator is absent),
 * and a forged assertion can never pass {@link verifyAssertionSignature} because
 * no matching credential is ever looked up on `verify`.
 */
const EMAIL_ALLOW_CREDENTIALS_SIZE = 32;
const EMAIL_ALLOW_REAL_CREDENTIALS = EMAIL_ALLOW_CREDENTIALS_SIZE / 2;
const MAX_EMAIL_LENGTH = 254;

type AllowCredential = { type: "public-key"; id: string; transports?: string[] };

type StoredCredential = { id: string; transports?: string[] };

const ROAMING_AUTHENTICATOR_TRANSPORTS = new Set(["usb", "nfc", "ble"]);
const ROAMING_CEREMONY_TRANSPORTS = ["ble", "nfc", "usb"];

type SecurityKeyCredential = {
  transports?: readonly string[];
  deviceType?: string;
  backedUp?: boolean;
};

function roamingTransports(transports: readonly string[] | undefined): string[] | undefined {
  if (
    !transports?.length ||
    !transports.every((value) => ROAMING_AUTHENTICATOR_TRANSPORTS.has(value))
  ) {
    return undefined;
  }
  return [...new Set(transports)].sort();
}

/** @internal */
export function isSecurityKeyCredential(credential: SecurityKeyCredential): boolean {
  return (
    roamingTransports(credential.transports) !== undefined &&
    (credential.deviceType === undefined || credential.deviceType === "singleDevice") &&
    (credential.backedUp === undefined || credential.backedUp === false)
  );
}

/** @internal */
export function selectAuthenticationCredentials<T extends StoredCredential>(
  credentials: readonly T[],
  securityKeysOnly: boolean | undefined,
): T[] {
  return securityKeysOnly ? credentials.filter(isSecurityKeyCredential) : [...credentials];
}

function requireSecurityKeyCredential(credential: SecurityKeyCredential): void {
  if (!isSecurityKeyCredential(credential)) {
    throw convexError(
      ErrorCode.PASSKEY_SECURITY_KEY_REQUIRED,
      "A roaming hardware security key is required.",
    );
  }
}

function credentialAuthenticationHints(
  credentials: readonly StoredCredential[],
): string[] | undefined {
  return credentials.length > 0 &&
    credentials.every((credential) => roamingTransports(credential.transports) !== undefined)
    ? ["security-key"]
    : undefined;
}

async function keyedDigest(key: CryptoKey, value: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function keyedBytes(key: CryptoKey, domain: string, length: number): Promise<Uint8Array> {
  const blocks = await Promise.all(
    Array.from({ length: Math.ceil(length / 32) }, (_, block) =>
      keyedDigest(key, `${domain}:block:${block}`),
    ),
  );
  const bytes = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += 32) {
    bytes.set(blocks[offset / 32].subarray(0, Math.min(32, length - offset)), offset);
  }
  return bytes;
}

function normalizeEmail(value: unknown): string {
  const email = requireStringParam(value, "email").trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) {
    throw convexError(ErrorCode.INVALID_PARAMETERS, "Email must be between 1 and 254 characters.");
  }
  return email;
}

async function deriveEmailAllowCredentials(
  normalizedEmail: string,
  rpId: string,
  realCredentials: readonly StoredCredential[],
  forceRoamingCeremony = false,
): Promise<AllowCredential[]> {
  const secret = requireAuthKey("webauthnMaskingKey");
  const emailSeed = encodeBase64urlNoPadding(
    new Uint8Array(sha256(new TextEncoder().encode(normalizedEmail))),
  );
  const realIds = realCredentials
    .flatMap((credential) => {
      try {
        const byteLength = decodeBase64urlIgnorePadding(credential.id).byteLength;
        return byteLength >= 1 && byteLength <= MAX_WEBAUTHN_CREDENTIAL_ID_LENGTH
          ? [
              {
                id: credential.id,
                byteLength,
                transports: roamingTransports(credential.transports),
              },
            ]
          : [];
      } catch {
        return [];
      }
    })
    .slice(0, EMAIL_ALLOW_REAL_CREDENTIALS);
  const ceremonyTransports =
    forceRoamingCeremony || credentialAuthenticationHints(realCredentials)
      ? ROAMING_CEREMONY_TRANSPORTS
      : undefined;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const makeCredential = async (
    id: string,
    discriminator: string,
    transports?: string[],
  ): Promise<AllowCredential & { order: string }> => ({
    type: "public-key",
    id,
    ...(transports === undefined ? {} : { transports }),
    order: encodeBase64urlNoPadding(
      await keyedDigest(
        key,
        `convex-auth:webauthn-order:v2:${rpId}:${emailSeed}:${discriminator}:${id}`,
      ),
    ),
  });

  const lengthSeed = await keyedDigest(key, `convex-auth:webauthn-lengths:v2:${rpId}:${emailSeed}`);
  const credentialPairs = await Promise.all(
    Array.from({ length: EMAIL_ALLOW_REAL_CREDENTIALS }, async (_, pairIndex) => {
      const real = realIds[pairIndex];
      const derivedLength =
        1 +
        (((lengthSeed[pairIndex * 2] << 8) | lengthSeed[pairIndex * 2 + 1]) %
          MAX_WEBAUTHN_CREDENTIAL_ID_LENGTH);
      const byteLength = real?.byteLength ?? derivedLength;
      const pairTransports = ceremonyTransports ?? real?.transports;
      const first = real
        ? await makeCredential(real.id, `real:${pairIndex}`, pairTransports)
        : await keyedBytes(
            key,
            `convex-auth:webauthn-decoy:v2:${rpId}:${emailSeed}:pair:${pairIndex}:first`,
            byteLength,
          ).then((bytes) =>
            makeCredential(
              encodeBase64urlNoPadding(bytes),
              `pair:${pairIndex}:first`,
              pairTransports,
            ),
          );
      const companion = await keyedBytes(
        key,
        `convex-auth:webauthn-decoy:v2:${rpId}:${emailSeed}:pair:${pairIndex}:companion`,
        byteLength,
      ).then((bytes) =>
        makeCredential(
          encodeBase64urlNoPadding(bytes),
          `pair:${pairIndex}:companion`,
          pairTransports,
        ),
      );
      return [first, companion];
    }),
  );
  const credentials = credentialPairs.flat();
  credentials.sort((a, b) => a.order.localeCompare(b.order));
  return credentials.map(({ type, id, transports }) => ({
    type,
    id,
    ...(transports === undefined ? {} : { transports }),
  }));
}

/**
 * Drive the passkey provider's `register` / `signIn` / `verify` flow.
 *
 * Dispatches on `args.params.flow`; for `verify` it auto-detects whether the
 * response completes a registration or a sign-in (see {@link WEBAUTHN_FLOWS}).
 *
 * @param ctx - Auth-enriched action context.
 * @param provider - The resolved WebAuthn provider config.
 * @param args - The flow params and, for `verify`, the issued challenge verifier.
 * @returns A WebAuthn challenge (`webauthnOptions`) or a signed-in session.
 */
export async function handleWebAuthn(
  ctx: EnrichedActionCtx,
  provider: WebAuthnProviderConfig,
  args: {
    params?: unknown;
    verifier?: string;
    continuation?: string;
  },
): Promise<WebAuthnResult> {
  const params = parsePasskeyParams(args.params);
  const dispatch = resolveWebAuthnDispatch(params);

  const handleRegisterVerify = async (): Promise<WebAuthnResult> => {
    const rp = resolveRpOptions(provider);
    const verifier = requirePasskeyVerifier(args.verifier);

    const encodedClientDataJSON = requireStringParam(params.clientDataJSON, "clientDataJSON");
    const clientDataJSON = decodeBase64urlIgnorePadding(encodedClientDataJSON);
    const clientData = parseClientDataJSON(clientDataJSON);
    verifyClientDataType(clientData, ClientDataType.Create, "webauthn.create");
    verifySameOrigin(clientData);
    verifyOrigin(clientData, rp);
    const challenge = await verifyAndConsumeChallenge(clientData, ctx, verifier);
    if (challenge.continuationId !== args.continuation) {
      throw convexError(ErrorCode.CONTINUATION_INVALID, "Invalid or expired continuation.");
    }
    let continuationId: string | undefined;
    let enrollmentId: string | undefined;
    let userId: string | undefined;
    if (challenge.continuationId !== undefined) {
      const continuation = await queryContinuation(ctx, challenge.continuationId);
      if (
        continuation === null ||
        continuation.provider !== provider.id ||
        continuation.operation !== "rotate"
      ) {
        throw convexError(ErrorCode.CONTINUATION_INVALID, "Invalid or expired continuation.");
      }
      continuationId = continuation._id;
      if (continuation.subject.kind === "user") {
        userId = continuation.subject.userId;
      } else {
        enrollmentId = continuation.subject.enrollmentId;
      }
    } else {
      userId = await requireAuthenticatedUserId(ctx);
    }

    const encodedAttestationObject = requireStringParam(
      params.attestationObject,
      "attestationObject",
    );
    const attestationObjectBytes = decodeBase64urlIgnorePadding(encodedAttestationObject);
    const rawAuthenticatorData = extractAttestationAuthenticatorData(attestationObjectBytes);
    const attestation = parseAttestationObject(attestationObjectBytes);
    const authData = attestation.authenticatorData;
    verifyRpId(authData, rp.rpId);
    verifyUserFlags(authData, rp.registration.userVerification);

    if (authData.credential == null) {
      throw convexError(ErrorCode.PASSKEY_NO_CREDENTIAL, "No credential in attestation.");
    }

    const credential = authData.credential;
    if (
      credential.id.byteLength < 1 ||
      credential.id.byteLength > MAX_WEBAUTHN_CREDENTIAL_ID_LENGTH
    ) {
      throw convexError(
        ErrorCode.PASSKEY_INVALID_CLIENT_DATA,
        `Credential ID must be between 1 and ${MAX_WEBAUTHN_CREDENTIAL_ID_LENGTH} bytes.`,
      );
    }
    const credentialId = encodeBase64urlNoPadding(credential.id);
    const publicKey = credential.publicKey;
    const algorithm = publicKey.isAlgorithmDefined()
      ? publicKey.algorithm()
      : publicKey.type() === COSEKeyType.EC2
        ? coseAlgorithmES256
        : publicKey.type() === COSEKeyType.RSA
          ? coseAlgorithmRS256
          : coseAlgorithmES256;
    validateCredentialAlgorithm(algorithm, rp.registration.algorithms);
    const publicKeyBytes = resolveRegistrationPublicKeyBytes(publicKey, algorithm);
    const backupState = parseBackupState(rawAuthenticatorData);
    if (provider.options.securityKeysOnly) {
      requireSecurityKeyCredential({
        transports: params.transports,
        deviceType: backupState.deviceType,
        backedUp: backupState.backedUp,
      });
    }
    let attestationEvidence: WebAuthnAttestationEvidence | undefined;
    if (rp.registration.attestation) {
      const { verifier: attestationVerifier } = rp.registration.attestation;
      try {
        const evidence = await attestationVerifier.verify({
          clientDataJSON: encodedClientDataJSON,
          attestationObject: encodedAttestationObject,
          credentialId,
          transports: params.transports,
          expectedChallenge: encodeBase64urlNoPadding(clientData.challenge),
          expectedOrigin: rp.origin,
          expectedRpId: rp.rpId,
          requireUserVerification: rp.registration.userVerification === "required",
          supportedAlgorithms: rp.registration.algorithms,
        });
        attestationEvidence = {
          ...evidence,
          verifier: attestationVerifier.id,
          verifiedAt: Date.now(),
          status: "trusted" as const,
        };
      } catch (error) {
        throw asConvexError(
          error,
          ErrorCode.PASSKEY_UNTRUSTED_ATTESTATION,
          "Authenticator attestation is not trusted.",
        );
      }
    }

    let completed:
      | Awaited<ReturnType<typeof mutatePasskeyCompleteRegistration>>
      | Exclude<Awaited<ReturnType<typeof mutatePasskeyCompleteRotation>>, { status: "rejected" }>
      | Exclude<
          Awaited<ReturnType<typeof callCompleteCredentialEnrollment>>,
          { status: "rejected" }
        >;
    try {
      const data = registrationData(
        credentialId,
        publicKeyBytes,
        algorithm,
        authData.signatureCounter,
        backupState,
        params,
        attestationEvidence,
        ctx,
      );
      if (continuationId === undefined) {
        if (userId === undefined) {
          throw convexError(
            ErrorCode.PASSKEY_AUTH_REQUIRED,
            "Passkey registration requires a user.",
          );
        }
        completed = await mutatePasskeyCompleteRegistration(ctx, {
          ...data,
          userId,
          replaceSession: await getAuthSessionReplacement(ctx),
        });
      } else if (enrollmentId !== undefined) {
        const enrollment = await callCompleteCredentialEnrollment(ctx, {
          ...data,
          continuationId,
          provider: provider.id,
          now: Date.now(),
        });
        if (enrollment.status === "rejected") {
          throw convexError(ErrorCode.CONTINUATION_INVALID, "Invalid or expired continuation.");
        }
        completed = enrollment;
      } else {
        if (userId === undefined) {
          throw convexError(ErrorCode.CONTINUATION_INVALID, "Invalid or expired continuation.");
        }
        const rotation = await mutatePasskeyCompleteRotation(ctx, {
          ...data,
          userId,
          continuationId,
          provider: provider.id,
        });
        if (rotation.status === "rejected") {
          throw convexError(ErrorCode.CONTINUATION_INVALID, "Invalid or expired continuation.");
        }
        completed = rotation;
      }
      const completedUserId = completed.user._id as GenericId<"User">;
      const passkeyId = completed.passkeyId as GenericId<"Passkey">;
      if ("removedPasskeyIds" in completed) {
        for (const removedPasskeyId of completed.removedPasskeyIds) {
          await queueAuthEvent(ctx, ctx.auth.config, {
            kind: "passkey.removed",
            actor: { type: "user", id: completedUserId },
            subject: { type: "passkey", id: removedPasskeyId },
            targets: [{ kind: "user", id: completedUserId }],
            outcome: "success",
            data: { passkeyId: removedPasskeyId },
          });
        }
      }
      await queueAuthEvent(ctx, ctx.auth.config, {
        kind: "passkey.added",
        actor: { type: "user", id: completedUserId },
        subject: { type: "passkey", id: passkeyId },
        targets: [{ kind: "user", id: completedUserId }],
        outcome: "success",
        data: { passkeyId, credentialId },
      });
      if ("passwordChanged" in completed && completed.passwordChanged) {
        await queueAuthEvent(ctx, ctx.auth.config, {
          kind: "password.changed",
          actor: { type: "user", id: completedUserId },
          subject: { type: "user", id: completedUserId },
          targets: [{ kind: "user", id: completedUserId }],
          outcome: "success",
          data: { flow: "reset" },
        });
      }
    } catch (err) {
      logPasskeyError(err);
      // Preserve structured failures (e.g. the credentialId-uniqueness guard in
      // `factor.passkey.create` firing when two registrations race the same
      // credential) instead of masking them as a generic internal error.
      if (err instanceof ConvexError) {
        throw err;
      }
      throw convexError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred.");
    }

    return await finalizePasskeySession(ctx, completed);
  };

  const handleAuthVerify = async (): Promise<WebAuthnResult> => {
    const rp = resolveRpOptions(provider);
    const verifier = requirePasskeyVerifier(args.verifier);

    const clientDataJSON = decodeBase64urlIgnorePadding(
      requireStringParam(params.clientDataJSON, "clientDataJSON"),
    );
    const clientData = parseClientDataJSON(clientDataJSON);
    verifyClientDataType(clientData, ClientDataType.Get, "webauthn.get");
    verifySameOrigin(clientData);
    verifyOrigin(clientData, rp);
    const credentialId = validateCredentialId(params.credentialId);
    const challengeHash = encodeBase64urlNoPadding(new Uint8Array(sha256(clientData.challenge)));
    let assertion;
    try {
      assertion = await mutatePasskeyBeginAssertion(ctx, {
        verifierId: verifier,
        expectedChallenge: challengeHash,
        credentialId,
      });
    } catch (error) {
      logPasskeyError(error);
      throw convexError(
        ErrorCode.PASSKEY_INVALID_CHALLENGE,
        "Invalid or expired passkey challenge.",
      );
    }
    if (!assertion.verifierAccepted) {
      throw convexError(
        ErrorCode.PASSKEY_INVALID_CHALLENGE,
        "Invalid or expired passkey challenge.",
      );
    }
    if (assertion.continuationId !== args.continuation) {
      throw convexError(ErrorCode.CONTINUATION_INVALID, "Invalid or expired continuation.");
    }

    const authenticatorDataBytes = decodeBase64urlIgnorePadding(
      requireStringParam(params.authenticatorData, "authenticatorData"),
    );
    const authenticatorData = parseAuthenticatorData(authenticatorDataBytes);
    const backupState = parseBackupState(authenticatorDataBytes);
    const signatureBytes = decodeBase64urlIgnorePadding(
      requireStringParam(params.signature, "signature"),
    );
    const signatureMessage = createAssertionSignatureMessage(
      authenticatorDataBytes,
      clientDataJSON,
    );
    const messageHash = sha256(signatureMessage);

    verifyRpId(authenticatorData, rp.rpId);
    verifyUserFlags(authenticatorData, rp.authentication.userVerification);

    const passkey = assertion.passkey;

    verifyAssertionSignatureUniformly(passkey, signatureBytes, messageHash);
    if (provider.options.securityKeysOnly) {
      requireSecurityKeyCredential(passkey);
      requireSecurityKeyCredential({
        transports: passkey.transports,
        deviceType: backupState.deviceType,
        backedUp: backupState.backedUp,
      });
    }
    validateBackupEligibility(passkey.deviceType, backupState.deviceType);

    if (rp.registration.attestation) {
      await assertStoredAttestationTrusted(rp.registration.attestation, passkey.attestation);
    }

    if (
      (passkey.counter !== 0 || authenticatorData.signatureCounter !== 0) &&
      authenticatorData.signatureCounter <= passkey.counter
    ) {
      throw convexError(
        ErrorCode.PASSKEY_COUNTER_ERROR,
        "Authenticator counter did not increase — possible credential cloning detected.",
      );
    }

    const replaceSession = await getAuthSessionReplacement(ctx);
    let completed;
    try {
      completed = await mutatePasskeyCompleteAssertion(ctx, {
        id: passkey._id,
        counter: authenticatorData.signatureCounter,
        lastUsedAt: Date.now(),
        backedUp: backupState.backedUp,
        replaceSession,
        sessionExpirationTime: sessionExpirationTime(ctx.auth.config),
        refreshTokenExpirationTime: refreshTokenExpirationTime(ctx.auth.config),
        ...(assertion.continuationId === undefined
          ? {}
          : {
              continuation: {
                id: assertion.continuationId,
                provider: provider.id,
              },
            }),
      });
    } catch (error) {
      throw asConvexError(error, ErrorCode.INTERNAL_ERROR, "Failed to finalize passkey sign-in.");
    }
    if (completed.status === "rejected") {
      throw convexError(
        ErrorCode.PASSKEY_COUNTER_ERROR,
        "Authenticator counter did not increase — possible credential cloning detected.",
      );
    }

    return await finalizePasskeySession(ctx, completed);
  };

  const flowHandlers = {
    register: async () => {
      const rp = resolveRpOptions(provider);

      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const challengeHash = encodeBase64urlNoPadding(new Uint8Array(sha256(challenge)));

      let registration;
      let userHandle: string;
      try {
        if (args.continuation === undefined) {
          userHandle = await requireAuthenticatedUserId(ctx);
          registration = await mutatePasskeyBeginRegistration(ctx, {
            userId: userHandle,
            sessionId: (await getAuthSessionId(ctx)) ?? undefined,
            signature: challengeHash,
            expirationTime: Date.now() + rp.challengeExpirationMs,
          });
        } else {
          const rotation = await mutatePasskeyBeginRotation(ctx, {
            continuationId: args.continuation,
            provider: provider.id,
            signature: challengeHash,
            expirationTime: Date.now() + rp.challengeExpirationMs,
          });
          if (rotation.status === "rejected") {
            throw convexError(ErrorCode.CONTINUATION_INVALID, "Invalid or expired continuation.");
          }
          userHandle = rotation.userHandle;
          registration = rotation;
        }
      } catch (err) {
        logPasskeyError(err);
        throw convexError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred.");
      }
      const user = registration.user;
      const userName = params.userName ?? user?.email ?? "user";
      const userDisplayName = params.userDisplayName ?? user?.name ?? userName;
      const existing = registration.credentials;
      if (args.continuation === undefined && existing.length >= MAX_WEBAUTHN_CREDENTIALS_PER_USER) {
        throw convexError(
          ErrorCode.INVALID_PARAMETERS,
          `A user can register at most ${MAX_WEBAUTHN_CREDENTIALS_PER_USER} WebAuthn credentials.`,
        );
      }
      const excludeCredentials = existing.map((credential) => ({
        id: credential.id,
        transports: credential.transports,
      }));

      const encodedUserHandle = encodeBase64urlNoPadding(new TextEncoder().encode(userHandle));

      return {
        kind: "webauthnOptions" as const,
        options: {
          rp: { name: rp.rpName, id: rp.rpId },
          user: { id: encodedUserHandle, name: userName, displayName: userDisplayName },
          challenge: encodeBase64urlNoPadding(challenge),
          pubKeyCredParams: rp.registration.algorithms.map((alg) => ({
            type: "public-key" as const,
            alg,
          })),
          timeout: rp.challengeExpirationMs,
          ...(rp.registration.hints === undefined ? {} : { hints: rp.registration.hints }),
          attestation: rp.registration.attestation?.conveyance ?? "none",
          authenticatorSelection: {
            residentKey: rp.registration.residentKey,
            requireResidentKey: rp.registration.residentKey === "required",
            userVerification: rp.registration.userVerification,
            ...(rp.registration.authenticatorAttachment === undefined
              ? {}
              : { authenticatorAttachment: rp.registration.authenticatorAttachment }),
          },
          excludeCredentials,
        },
        verifier: registration.verifierId,
        ...(args.continuation === undefined
          ? {}
          : { continuation: args.continuation, operation: "rotate" as const }),
      };
    },

    signIn: async () => {
      const rp = resolveRpOptions(provider);
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const challengeHash = encodeBase64urlNoPadding(new Uint8Array(sha256(challenge)));

      let allowCredentials: AllowCredential[] | undefined;
      let credentialHints: string[] | undefined;
      const email = params.email === undefined ? undefined : normalizeEmail(params.email);
      const sessionId = (await getAuthSessionId(ctx)) ?? undefined;
      let signIn;
      try {
        signIn = await mutatePasskeyBeginSignIn(ctx, {
          sessionId,
          signature: challengeHash,
          expirationTime: Date.now() + rp.challengeExpirationMs,
          ...(args.continuation === undefined
            ? {}
            : {
                continuation: {
                  id: args.continuation,
                  provider: provider.id,
                },
              }),
          ...(email === undefined ? {} : { verifiedEmail: email }),
        });
      } catch (err) {
        logPasskeyError(err);
        throw convexError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred.");
      }

      if (email !== undefined) {
        const securityKeysOnly = provider.options.securityKeysOnly === true;
        const eligibleCredentials = selectAuthenticationCredentials(
          signIn.credentials,
          securityKeysOnly,
        );
        allowCredentials = await deriveEmailAllowCredentials(
          email,
          rp.rpId,
          eligibleCredentials,
          securityKeysOnly,
        );
        credentialHints = securityKeysOnly
          ? ["security-key"]
          : credentialAuthenticationHints(eligibleCredentials);
      }

      const hints = rp.authentication.hints ?? credentialHints;
      return {
        kind: "webauthnOptions" as const,
        options: {
          challenge: encodeBase64urlNoPadding(challenge),
          timeout: rp.challengeExpirationMs,
          rpId: rp.rpId,
          userVerification: rp.authentication.userVerification,
          ...(hints === undefined ? {} : { hints }),
          ...(allowCredentials === undefined ? {} : { allowCredentials }),
        },
        verifier: signIn.verifierId,
        ...(args.continuation === undefined
          ? {}
          : { continuation: args.continuation, operation: "signIn" as const }),
      };
    },

    verify: async () => {
      const isRegistration =
        typeof params.attestationObject === "string" && params.attestationObject.length > 0;
      const isAuthentication = typeof params.signature === "string" && params.signature.length > 0;

      if (isRegistration && !isAuthentication) {
        return await handleRegisterVerify();
      }
      if (isAuthentication && !isRegistration) {
        return await handleAuthVerify();
      }
      throw convexError(
        ErrorCode.PASSKEY_INVALID_VERIFY,
        "`verify` flow requires either `attestationObject` (to complete a `register`) " +
          "or `signature` + `credentialId` (to complete a `signIn`).",
      );
    },
  } satisfies Record<WebAuthnFlow, () => Promise<WebAuthnResult>>;

  const handler = flowHandlers[dispatch.flow];
  if (!handler) {
    throw convexError(ErrorCode.PASSKEY_MISSING_FLOW, `Unknown passkey flow: ${dispatch.flow}`);
  }
  return handler();
}
