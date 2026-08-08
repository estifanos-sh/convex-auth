/**
 * Shared auth result payload types used across client and server internals.
 *
 * @module
 */

import type { AccessToken, RefreshToken } from "./brand";

/** Access/refresh token pair issued on a successful sign-in. */
export type AuthTokens = {
  token: AccessToken;
  refreshToken: RefreshToken;
};

/** Data needed to provision a TOTP authenticator (otpauth URI + shared secret). */
export type TotpSetupPayload = {
  uri: string;
  secret: string;
  totpId: string;
};

/** Device authorization grant details returned to a polling device client. */
export type DeviceCodePayload = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

/** Terminal sign-in result: the user is authenticated and a session exists. */
export type SignInSessionResult<TSession> = {
  kind: "signedIn";
  session: TSession;
};

/** Sign-in result requiring the client to follow an OAuth redirect. */
export type SignInRedirectResult<TRedirect = string> = {
  kind: "redirect";
  redirect: TRedirect;
  verifier: string;
};

/** Sign-in result indicating a verification flow was started (e.g. OTP sent). */
export type SignInStartResult = {
  kind: "started";
};

/** Sign-in result carrying options for a WebAuthn ceremony. */
export type SignInWebAuthnOptionsResult = {
  kind: "webauthnOptions";
  options: Record<string, unknown>;
  verifier: string;
};

/** Sign-in result requesting a TOTP code to complete two-factor sign-in. */
export type SignInTotpChallengeResult = {
  kind: "totpRequired";
  verifier: string;
};

/** Sign-in result requesting TOTP enrollment before sign-in can complete. */
export type SignInTotpSetupResult<TTotpSetup = TotpSetupPayload> = {
  kind: "totpSetup";
  totpSetup: TTotpSetup;
  verifier: string;
};

/** Sign-in result returning a device code for the device authorization flow. */
export type SignInDeviceCodeResult<TDeviceCode = DeviceCodePayload> = {
  kind: "deviceCode";
  deviceCode: TDeviceCode;
};

/** Discriminated union of every possible sign-in flow outcome, keyed by `kind`. */
export type SignInFlowResult<TSession, TRedirect = string> =
  | SignInSessionResult<TSession>
  | SignInRedirectResult<TRedirect>
  | SignInStartResult
  | SignInWebAuthnOptionsResult
  | SignInTotpChallengeResult
  | SignInTotpSetupResult
  | SignInDeviceCodeResult;
