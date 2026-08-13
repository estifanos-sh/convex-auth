/**
 * WebAuthn authentication provider.
 *
 * @module
 */

import type { WebAuthnAttestationPolicy, WebAuthnProviderConfig } from "../server/types";
import { fidoMds } from "./webauthn/attestation";

/** WebAuthn Level 3 hints that browsers may use to guide authenticator selection. */
export type WebAuthnHint = "security-key" | "client-device" | "hybrid";

/** COSE algorithms supported by the WebAuthn verifier. */
export type WebAuthnAlgorithm = -7 | -257;

/** Registration-ceremony options for the {@link webauthn} provider. */
export interface WebAuthnRegistrationConfig {
  /** Restrict registration to platform or roaming authenticators. */
  authenticatorAttachment?: "platform" | "cross-platform";
  /** Discoverable credential preference. */
  residentKey?: "required" | "preferred" | "discouraged";
  /** User verification requirement for registration. */
  userVerification?: "required" | "preferred" | "discouraged";
  /** Non-binding hints used by supporting browsers to guide authenticator selection. */
  hints?: readonly WebAuthnHint[];
  /** Supported COSE algorithms in authenticator preference order. */
  algorithms?: readonly WebAuthnAlgorithm[];
  /**
   * Strict authenticator-attestation policy. When present, registration and
   * every later sign-in fail unless the credential has current trusted
   * evidence from this policy.
   */
  attestation?: WebAuthnAttestationPolicy;
}

/** Authentication-ceremony options for the {@link webauthn} provider. */
export interface WebAuthnAuthenticationConfig {
  /** User verification requirement for authentication. */
  userVerification?: "required" | "preferred" | "discouraged";
  /** Non-binding hints used by supporting browsers to guide authenticator selection. */
  hints?: readonly WebAuthnHint[];
}

/** Configuration for the {@link webauthn} provider. */
export interface WebAuthnConfig {
  /** Human-readable relying party name shown in authenticator prompts. */
  rpName?: string;
  /** Relying party ID, typically your app's hostname. */
  rpId?: string;
  /** Allowed origins for registration and authentication ceremonies. */
  origin?: string | readonly string[];
  /** Challenge lifetime in milliseconds before a ceremony expires. */
  challengeExpirationMs?: number;
  /**
   * Accept only non-backed-up roaming security keys (USB, NFC, or BLE).
   *
   * This is an enforced server policy, not only a browser hint. Existing
   * platform or synced passkeys are neither offered nor accepted.
   */
  securityKeysOnly?: boolean;
  /** Credential-creation ceremony options. */
  registration?: WebAuthnRegistrationConfig;
  /** Credential-authentication ceremony options. */
  authentication?: WebAuthnAuthenticationConfig;
}

/**
 * Create a WebAuthn provider.
 *
 * @param config - Optional relying-party and ceremony-specific settings.
 * @returns A configured WebAuthn provider for `defineAuth`.
 *
 * @example
 * ```ts
 * import { webauthn } from "@estifanos-sh/convex-auth/providers";
 *
 * webauthn({
 *   rpName: "Staff access",
 *   registration: {
 *     authenticatorAttachment: "cross-platform",
 *     residentKey: "discouraged",
 *     userVerification: "required",
 *     hints: ["security-key"],
 *     attestation: webauthn.attestation.fidoMds(),
 *   },
 *   authentication: {
 *     userVerification: "required",
 *     hints: ["security-key"],
 *   },
 * })
 * ```
 */
export const webauthn = Object.assign(
  function webauthn(config: WebAuthnConfig = {}): WebAuthnProviderConfig {
    return {
      id: "webauthn",
      type: "webauthn",
      options: {
        rpName: config.rpName,
        rpId: config.rpId,
        origin:
          typeof config.origin === "string"
            ? config.origin
            : config.origin
              ? [...config.origin]
              : undefined,
        challengeExpirationMs: config.challengeExpirationMs ?? 300_000,
        securityKeysOnly: config.securityKeysOnly ?? false,
        registration: {
          residentKey: config.registration?.residentKey ?? "preferred",
          userVerification: config.registration?.userVerification ?? "required",
          algorithms: [...(config.registration?.algorithms ?? [-7, -257])],
          ...(config.securityKeysOnly
            ? { authenticatorAttachment: "cross-platform" as const }
            : config.registration?.authenticatorAttachment
              ? { authenticatorAttachment: config.registration.authenticatorAttachment }
              : {}),
          ...(config.securityKeysOnly
            ? { hints: ["security-key" as const] }
            : config.registration?.hints
              ? { hints: [...config.registration.hints] }
              : {}),
          ...(config.registration?.attestation
            ? { attestation: config.registration.attestation }
            : {}),
        },
        authentication: {
          userVerification: config.authentication?.userVerification ?? "required",
          ...(config.securityKeysOnly
            ? { hints: ["security-key" as const] }
            : config.authentication?.hints
              ? { hints: [...config.authentication.hints] }
              : {}),
        },
      },
    };
  },
  {
    /** WebAuthn attestation policies. */
    attestation: Object.freeze({ fidoMds }),
  },
);

export type { WebAuthnAttestationEvidence, WebAuthnAttestationPolicy } from "../server/types";
