/**
 * WebAuthn policy vocabulary shared by the provider factory and the
 * per-ceremony override path.
 *
 * Both need to agree on which fields `securityKeysOnly` implies and what it
 * sets them to. Stating that once here is the point of the module: a second
 * copy drifts, and a half-applied policy is a security bug rather than a
 * cosmetic one.
 *
 * @module
 */

/** Maximum WebAuthn credentials stored for one user. */
export const MAX_WEBAUTHN_CREDENTIALS_PER_USER = 16;

/** Maximum credential ID length accepted by WebAuthn Level 3. */
export const MAX_WEBAUTHN_CREDENTIAL_ID_LENGTH = 1023;

/** WebAuthn Level 3 hints a browser may use to guide authenticator selection. */
export type WebAuthnHintName = "security-key" | "client-device" | "hybrid";

/** Authenticator attachment values. */
export type WebAuthnAttachment = "platform" | "cross-platform";

/** Resident-key (discoverable credential) preference. */
export type WebAuthnResidentKey = "discouraged" | "preferred" | "required";

/** User-verification preference. */
export type WebAuthnUserVerification = "discouraged" | "preferred" | "required";

/** The registration fields `securityKeysOnly` governs. */
type CoupledRegistration = {
  authenticatorAttachment?: WebAuthnAttachment;
  hints?: WebAuthnHintName[];
};

/** The authentication fields `securityKeysOnly` governs. */
type CoupledAuthentication = {
  hints?: WebAuthnHintName[];
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
