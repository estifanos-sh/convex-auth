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
import { ConvexError } from "convex/values";

import { ErrorCode } from "../shared/codes";
import {
  MAX_WEBAUTHN_CREDENTIAL_ID_LENGTH,
  MAX_WEBAUTHN_CREDENTIALS_PER_USER,
} from "../shared/webauthn";
import { authFlowError } from "../shared/errors";
import { requireEnv } from "./env";
import type { AuthErrorData } from "./errors";
import { toConvexError } from "./errors";
import { emitAuthEvent } from "./events";
import { getAuthenticatedUserIdOrNull } from "./identity/claims";
import { reserveSignInAttempt, resetSignInRateLimit } from "./limits";
import { LOG_LEVELS, log } from "./log";
import { callSignIn, callVerifier } from "./mutations/calls";
import {
  consumeVerifierById,
  mutatePasskeyInsert,
  mutatePasskeyUpdateCounter,
  queryPasskeyByCredentialId,
  queryPasskeysByUserId,
  queryUserById,
  queryUserByVerifiedEmail,
} from "./component/factor/db";
import {
  AuthDataModel,
  GenericActionCtxWithAuthConfig,
  WebAuthnAttestationEvidence,
  WebAuthnAttestationPolicy,
  WebAuthnProviderConfig,
  SessionInfo,
} from "./types";
import { appUrlFromEnv } from "./url";

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

type PasskeyParams = {
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

const requireStringParam = (value: unknown, name: string) => {
  if (typeof value !== "string") {
    throw convexError(ErrorCode.INVALID_PARAMETERS, `Missing \`${name}\` parameter.`);
  }
  return value;
};

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
    return {
      rpName: provider.options.rpName ?? appHostname ?? provider.options.rpId ?? "localhost",
      rpId: provider.options.rpId ?? appHostname ?? "localhost",
      origin: provider.options.origin ?? appUrl ?? "http://localhost",
      challengeExpirationMs: provider.options.challengeExpirationMs ?? 300_000,
      registration: {
        userVerification: provider.options.registration.userVerification ?? "required",
        residentKey: provider.options.registration.residentKey ?? "preferred",
        algorithms: provider.options.registration.algorithms ?? [
          coseAlgorithmES256,
          coseAlgorithmRS256,
        ],
        ...(provider.options.registration.authenticatorAttachment
          ? {
              authenticatorAttachment: provider.options.registration.authenticatorAttachment,
            }
          : {}),
        ...(provider.options.registration.hints
          ? { hints: provider.options.registration.hints }
          : {}),
        ...(provider.options.registration.attestation
          ? { attestation: provider.options.registration.attestation }
          : {}),
      },
      authentication: {
        userVerification: provider.options.authentication.userVerification ?? "required",
        ...(provider.options.authentication.hints
          ? { hints: provider.options.authentication.hints }
          : {}),
      },
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
): Promise<T> {
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
  return clientData;
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

function resolveWebAuthnDispatch(params: Record<string, unknown>): WebAuthnDispatch {
  const flow = params.flow;
  if (typeof flow === "string" && (WEBAUTHN_FLOWS as readonly string[]).includes(flow)) {
    return { flow: flow as WebAuthnFlow };
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
 * sign-in. Real credential IDs are mixed with deterministic decoys, all without
 * transport metadata, then ordered by a secret-keyed digest.
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

type AllowCredential = { type: "public-key"; id: string };

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
  realCredentialIds: readonly string[],
): Promise<AllowCredential[]> {
  const secret = requireEnv("JWT_PRIVATE_KEY");
  const emailSeed = encodeBase64urlNoPadding(
    new Uint8Array(sha256(new TextEncoder().encode(normalizedEmail))),
  );
  const realIds = realCredentialIds
    .flatMap((id) => {
      try {
        const byteLength = decodeBase64urlIgnorePadding(id).byteLength;
        return byteLength >= 1 && byteLength <= MAX_WEBAUTHN_CREDENTIAL_ID_LENGTH
          ? [{ id, byteLength }]
          : [];
      } catch {
        return [];
      }
    })
    .slice(0, EMAIL_ALLOW_REAL_CREDENTIALS);
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
  ): Promise<AllowCredential & { order: string }> => ({
    type: "public-key",
    id,
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
      const first = real
        ? await makeCredential(real.id, `real:${pairIndex}`)
        : await keyedBytes(
            key,
            `convex-auth:webauthn-decoy:v2:${rpId}:${emailSeed}:pair:${pairIndex}:first`,
            byteLength,
          ).then((bytes) =>
            makeCredential(encodeBase64urlNoPadding(bytes), `pair:${pairIndex}:first`),
          );
      const companion = await keyedBytes(
        key,
        `convex-auth:webauthn-decoy:v2:${rpId}:${emailSeed}:pair:${pairIndex}:companion`,
        byteLength,
      ).then((bytes) =>
        makeCredential(encodeBase64urlNoPadding(bytes), `pair:${pairIndex}:companion`),
      );
      return [first, companion];
    }),
  );
  const credentials = credentialPairs.flat();
  credentials.sort((a, b) => a.order.localeCompare(b.order));
  return credentials.map(({ type, id }) => ({ type, id }));
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
    params?: Record<string, unknown>;
    verifier?: string;
  },
): Promise<WebAuthnResult> {
  const params = (args.params ?? {}) as PasskeyParams;
  const dispatch = resolveWebAuthnDispatch(params);

  const handleRegisterVerify = async (): Promise<WebAuthnResult> => {
    const userId = await requireAuthenticatedUserId(ctx);
    const rp = resolveRpOptions(provider);
    const verifier = requirePasskeyVerifier(args.verifier);

    const encodedClientDataJSON = requireStringParam(params.clientDataJSON, "clientDataJSON");
    const clientDataJSON = decodeBase64urlIgnorePadding(encodedClientDataJSON);
    const clientData = parseClientDataJSON(clientDataJSON);
    verifyClientDataType(clientData, ClientDataType.Create, "webauthn.create");
    verifySameOrigin(clientData);
    verifyOrigin(clientData, rp);
    await verifyAndConsumeChallenge(clientData, ctx, verifier);

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

    try {
      const passkeyId = await mutatePasskeyInsert(ctx, {
        userId,
        credentialId,
        publicKey: publicKeyBytes.buffer.slice(
          publicKeyBytes.byteOffset,
          publicKeyBytes.byteOffset + publicKeyBytes.byteLength,
        ) as ArrayBuffer,
        algorithm,
        counter: authData.signatureCounter,
        transports: params.transports,
        deviceType: backupState.deviceType,
        backedUp: backupState.backedUp,
        name: params.passkeyName,
        ...(attestationEvidence ? { attestation: attestationEvidence } : {}),
        createdAt: Date.now(),
      });
      await emitAuthEvent(ctx, ctx.auth.config, {
        kind: "passkey.added",
        actor: { type: "user", id: userId },
        subject: { type: "passkey", id: passkeyId },
        targets: [{ kind: "user", id: userId }],
        outcome: "success",
        data: { passkeyId, credentialId },
      });
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

    let signInResult;
    try {
      signInResult = await callSignIn(ctx, {
        userId,
        generateTokens: true,
      });
    } catch (error) {
      throw asConvexError(
        error,
        ErrorCode.INTERNAL_ERROR,
        "Failed to finalize passkey registration.",
      );
    }
    return { kind: "signedIn" as const, session: signInResult };
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
    await verifyAndConsumeChallenge(clientData, ctx, verifier);

    const credentialId = requireStringParam(params.credentialId, "credentialId");
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

    let passkey = null;
    try {
      passkey = await queryPasskeyByCredentialId(ctx, credentialId);
    } catch (err) {
      // Corrupt duplicate rows must not turn the credential lookup into an
      // externally distinguishable account-existence signal.
      logPasskeyError(err);
    }

    const rateLimitIdentifier = `webauthn:credential:${encodeBase64urlNoPadding(
      new Uint8Array(sha256(new TextEncoder().encode(credentialId))),
    )}`;
    // Real and unknown credentials use the same stable, non-PII bucket shape.
    // A successful assertion refunds only its own credential bucket below.
    if (await reserveSignInAttempt(ctx, rateLimitIdentifier, ctx.auth.config)) {
      throw convexError(ErrorCode.RATE_LIMITED, "Too many passkey attempts. Try again later.");
    }

    verifyAssertionSignatureUniformly(passkey, signatureBytes, messageHash);
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

    try {
      const counterAccepted = await mutatePasskeyUpdateCounter(
        ctx,
        passkey._id,
        authenticatorData.signatureCounter,
        Date.now(),
        backupState.backedUp,
      );
      if (!counterAccepted) {
        throw convexError(
          ErrorCode.PASSKEY_COUNTER_ERROR,
          "Authenticator counter did not increase — possible credential cloning detected.",
        );
      }
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      throw asConvexError(error, ErrorCode.INTERNAL_ERROR, "Failed to update passkey counter.");
    }

    // Only the assertion that won the atomic counter transition may refund the
    // reserved attempt. A concurrent stale assertion must not clear the shared
    // rate-limit bucket before it is rejected above.
    await resetSignInRateLimit(ctx, rateLimitIdentifier, ctx.auth.config);

    let signInResult;
    try {
      signInResult = await callSignIn(ctx, {
        userId: passkey.userId,
        generateTokens: true,
      });
    } catch (error) {
      throw asConvexError(error, ErrorCode.INTERNAL_ERROR, "Failed to finalize passkey sign-in.");
    }

    return { kind: "signedIn" as const, session: signInResult };
  };

  const flowHandlers: Record<WebAuthnFlow, () => Promise<WebAuthnResult>> = {
    register: async () => {
      const userId = await requireAuthenticatedUserId(ctx);
      const rp = resolveRpOptions(provider);

      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const challengeHash = encodeBase64urlNoPadding(new Uint8Array(sha256(challenge)));

      let verifier: string;
      try {
        verifier = await callVerifier(ctx, challengeHash, Date.now() + rp.challengeExpirationMs);
      } catch (err) {
        logPasskeyError(err);
        throw convexError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred.");
      }

      let user;
      try {
        user = await queryUserById(ctx, userId);
      } catch (err) {
        logPasskeyError(err);
        throw convexError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred.");
      }
      const userName = params.userName ?? user?.email ?? "user";
      const userDisplayName = params.userDisplayName ?? user?.name ?? userName;

      let existing;
      try {
        existing = await queryPasskeysByUserId(ctx, userId);
      } catch (err) {
        logPasskeyError(err);
        throw convexError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred.");
      }
      if (existing.length >= MAX_WEBAUTHN_CREDENTIALS_PER_USER) {
        throw convexError(
          ErrorCode.INVALID_PARAMETERS,
          `A user can register at most ${MAX_WEBAUTHN_CREDENTIALS_PER_USER} WebAuthn credentials.`,
        );
      }
      const excludeCredentials = existing.map((pk) => ({
        id: pk.credentialId,
        transports: pk.transports,
      }));

      const userHandle = encodeBase64urlNoPadding(new TextEncoder().encode(userId));

      return {
        kind: "webauthnOptions" as const,
        options: {
          rp: { name: rp.rpName, id: rp.rpId },
          user: {
            id: userHandle,
            name: userName,
            displayName: userDisplayName,
          },
          challenge: encodeBase64urlNoPadding(challenge),
          pubKeyCredParams: rp.registration.algorithms.map((alg) => ({
            type: "public-key" as const,
            alg,
          })),
          timeout: rp.challengeExpirationMs,
          ...(rp.registration.hints ? { hints: rp.registration.hints } : {}),
          attestation: rp.registration.attestation?.conveyance ?? "none",
          authenticatorSelection: {
            residentKey: rp.registration.residentKey,
            requireResidentKey: rp.registration.residentKey === "required",
            userVerification: rp.registration.userVerification,
            ...(rp.registration.authenticatorAttachment
              ? {
                  authenticatorAttachment: rp.registration.authenticatorAttachment,
                }
              : {}),
          },
          excludeCredentials,
        },
        verifier,
      };
    },

    signIn: async () => {
      const rp = resolveRpOptions(provider);
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const challengeHash = encodeBase64urlNoPadding(new Uint8Array(sha256(challenge)));

      let verifier: string;
      try {
        verifier = await callVerifier(ctx, challengeHash, Date.now() + rp.challengeExpirationMs);
      } catch (err) {
        logPasskeyError(err);
        throw convexError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred.");
      }

      let allowCredentials: AllowCredential[] | undefined;

      if (params.email !== undefined) {
        const email = normalizeEmail(params.email);
        let user;
        try {
          user = await queryUserByVerifiedEmail(ctx, email);
        } catch (err) {
          logPasskeyError(err);
          throw convexError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred.");
        }
        let realCredentialIds: string[] = [];
        if (user) {
          let passkeys;
          try {
            passkeys = await queryPasskeysByUserId(ctx, user._id);
          } catch (err) {
            logPasskeyError(err);
            throw convexError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred.");
          }
          realCredentialIds = passkeys.map((pk) => pk.credentialId);
        }
        allowCredentials = await deriveEmailAllowCredentials(email, rp.rpId, realCredentialIds);
      }

      const options: {
        challenge: string;
        timeout: number;
        rpId: string;
        userVerification: string;
        hints?: string[];
        allowCredentials?: Array<{
          type: "public-key";
          id: string;
        }>;
      } = {
        challenge: encodeBase64urlNoPadding(challenge),
        timeout: rp.challengeExpirationMs,
        rpId: rp.rpId,
        userVerification: rp.authentication.userVerification,
        ...(rp.authentication.hints ? { hints: rp.authentication.hints } : {}),
      };

      if (allowCredentials) {
        options.allowCredentials = allowCredentials;
      }

      return {
        kind: "webauthnOptions" as const,
        options,
        verifier,
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
  };

  const handler = flowHandlers[dispatch.flow];
  if (!handler) {
    throw convexError(ErrorCode.PASSKEY_MISSING_FLOW, `Unknown passkey flow: ${dispatch.flow}`);
  }
  return handler();
}
