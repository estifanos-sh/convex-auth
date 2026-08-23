/**
 * WebAuthn vocabulary and policy shared by the provider config, the server
 * ceremony runtime, and the Expo native bridge.
 *
 * The unions mirror the WebAuthn Level 3 enumerations. They are declared here
 * rather than pulled from `lib.dom` because the server and component tsconfigs
 * do not include the DOM library, and re-spelling them at each layer let the
 * registration and authentication options drift apart.
 *
 * The `securityKeysOnly` coupling lives here for the same reason: the provider
 * factory and the per-ceremony override path both need to agree on which fields
 * it implies and what it sets them to, and a second copy of that definition
 * drifts into a half-applied policy, which is a security bug rather than a
 * cosmetic one.
 *
 * This module holds no imports, so every layer can depend on it.
 *
 * @module
 */

/** Maximum WebAuthn credentials stored for one user. */
export const MAX_WEBAUTHN_CREDENTIALS_PER_USER = 16;

/** Maximum credential ID length accepted by WebAuthn Level 3. */
export const MAX_WEBAUTHN_CREDENTIAL_ID_LENGTH = 1023;

/** User verification requirement for a WebAuthn ceremony. */
export type WebAuthnUserVerification = "required" | "preferred" | "discouraged";

/** Discoverable (resident) credential preference for a registration ceremony. */
export type WebAuthnResidentKey = "required" | "preferred" | "discouraged";

/** Authenticator attachment modality: built-in platform vs. roaming authenticator. */
export type WebAuthnAttachment = "platform" | "cross-platform";

/** WebAuthn Level 3 hints that browsers may use to guide authenticator selection. */
export type WebAuthnHint = "security-key" | "client-device" | "hybrid";

/** COSE algorithms supported by the WebAuthn verifier. */
export type WebAuthnAlgorithm = -7 | -257;

/** The registration fields `securityKeysOnly` governs. */
type CoupledRegistration = {
  authenticatorAttachment?: WebAuthnAttachment;
  hints?: WebAuthnHint[];
};

/** The authentication fields `securityKeysOnly` governs. */
type CoupledAuthentication = {
  hints?: WebAuthnHint[];
};

/**
 * Constrain a ceremony to portable security keys.
 *
 * `securityKeysOnly` is not a single flag the verifier reads later — it is
 * shorthand for a cross-platform attachment plus security-key hints on both
 * halves of the ceremony. Setting them together is what makes the shorthand
 * true.
 */
export function coupleSecurityKeysOnly(
  registration: CoupledRegistration,
  authentication: CoupledAuthentication,
): void {
  registration.authenticatorAttachment = "cross-platform";
  registration.hints = ["security-key"];
  authentication.hints = ["security-key"];
}

/**
 * Release the constraint, leaving the fields unset.
 *
 * Turning the shorthand off has to clear everything it set, or a ceremony that
 * widens the policy still carries security-key hints and silently refuses the
 * platform authenticator the caller just asked for.
 */
export function decoupleSecurityKeysOnly(
  registration: CoupledRegistration,
  authentication: CoupledAuthentication,
): void {
  delete registration.authenticatorAttachment;
  delete registration.hints;
  delete authentication.hints;
}
