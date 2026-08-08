/**
 * Provider exports for `@estifanos-sh/convex-auth/providers`.
 *
 * @module
 */

export { password } from "./password";
export type { PasswordConfig } from "./password";
export { webauthn } from "./webauthn";
export type {
  WebAuthnAttestationEvidence,
  WebAuthnAttestationPolicy,
  WebAuthnAlgorithm,
  WebAuthnAuthenticationConfig,
  WebAuthnConfig,
  WebAuthnHint,
  WebAuthnRegistrationConfig,
} from "./webauthn";
export { totp } from "./totp";
export type { TotpConfig } from "./totp";
export { google } from "./google";
export type { GoogleConfig } from "./google";
export { github } from "./github";
export type { GitHubConfig } from "./github";
export { apple } from "./apple";
export type { AppleConfig } from "./apple";
export { microsoft } from "./microsoft";
export type { MicrosoftConfig } from "./microsoft";
export { custom } from "./custom";
export type {
  CustomOAuthAuthorizationConfig,
  CustomOAuthConfig,
  CustomOAuthTokenConfig,
} from "./custom";
export { anonymous } from "./anonymous";
export type { AnonymousConfig } from "./anonymous";
export { credentials } from "./credentials";
export type {
  CredentialsAuthorizeResult,
  CredentialsConfig,
  CredentialsProvisioning,
} from "./credentials";
export { device } from "./device";
export type { DeviceConfig } from "./device";
export { connection } from "./connection";
export { email } from "./email";
export type { EmailProviderConfig } from "./email";
export type { EmailConfig } from "../server/types";
export type { OAuthProfile, OAuthTokens } from "../server/types";
export { phone } from "./phone";
export type { PhoneProviderConfig } from "./phone";
export type { PhoneConfig } from "../server/types";
