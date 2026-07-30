/**
 * Passkey (WebAuthn) authentication provider.
 *
 * ```ts
 * import { passkey } from "@robelest/convex-auth/providers";
 *
 * passkey({ rpName: "My App" })
 * ```
 *
 * @module
 */

import type { PasskeyProviderConfig } from "../server/types";

/** Configuration for the {@link passkey} provider. */
export interface PasskeyConfig {
  /**
   * WebAuthn credential policy. Defaults to `"passkey"`.
   *
   * `"security-key"` enforces a roaming authenticator with user verification,
   * discourages discoverable credentials, and asks supporting browsers to
   * prioritize security keys in their picker.
   */
  mode?: "passkey" | "security-key";
  /** Human-readable relying party name shown in authenticator prompts. */
  rpName?: string;
  /** Relying party ID, typically your app's hostname. */
  rpId?: string;
  /** Allowed origins for registration and authentication ceremonies. */
  origin?: string | string[];
  /** Attestation conveyance preference sent to authenticators. */
  attestation?: "none" | "direct";
  /** User verification requirement for authentication ceremonies. */
  userVerification?: "required" | "preferred" | "discouraged";
  /** Discoverable credential preference for resident keys. */
  residentKey?: "required" | "preferred" | "discouraged";
  /** Restrict credentials to platform or roaming authenticators. */
  authenticatorAttachment?: "platform" | "cross-platform";
  /** Supported COSE algorithms in authenticator preference order. */
  algorithms?: number[];
  /** Challenge lifetime in milliseconds before registration/login expires. */
  challengeExpirationMs?: number;
}

/**
 * Create a passkey provider.
 *
 * @param config - Optional WebAuthn relying party and challenge settings.
 * @returns A configured passkey provider for `defineAuth`.
 *
 * @example
 * ```ts
 * import { passkey } from "@robelest/convex-auth/providers";
 *
 * passkey({ rpName: "My App" })
 * ```
 */
export function passkey(config: PasskeyConfig = {}): PasskeyProviderConfig {
  const { mode = "passkey", ...options } = config;
  const securityKeyPolicy =
    mode === "security-key"
      ? ({
          authenticatorAttachment: "cross-platform",
          residentKey: "discouraged",
          userVerification: "required",
        } as const)
      : {};

  return {
    id: "passkey",
    type: "passkey",
    options: {
      credentialPolicy: mode === "security-key" ? "security_key" : "passkey",
      attestation: "none",
      userVerification: "required",
      residentKey: "preferred",
      algorithms: [-7, -257],
      challengeExpirationMs: 300_000,
      ...options,
      ...securityKeyPolicy,
    },
  };
}
