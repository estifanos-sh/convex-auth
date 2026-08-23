/**
 * TOTP (Time-based One-Time Password) two-factor authentication provider.
 *
 * ```ts
 * import { totp } from "@estifanos-sh/convex-auth/providers/totp";
 *
 * totp({ issuer: "My App" })
 * ```
 *
 * @module
 */

import type { TotpProviderConfig } from "../server/types";

/** Configuration for the {@link totp} provider. */
export interface TotpConfig {
  /** Issuer label embedded in the otpauth URI shown to authenticator apps. */
  issuer?: string;
  /** Number of digits expected in generated TOTP codes. */
  digits?: number;
  /** Time step, in seconds, used when generating and validating codes. */
  period?: number;
}

/**
 * Create a TOTP provider.
 *
 * @param config - Optional issuer and token generation settings.
 * @returns A configured TOTP provider for `defineAuth`.
 *
 * @example
 * ```ts
 * import { totp } from "@estifanos-sh/convex-auth/providers/totp";
 *
 * totp({ issuer: "My App" })
 * ```
 */
export function totp(config: TotpConfig = {}): TotpProviderConfig {
  return {
    id: "totp",
    type: "totp",
    options: {
      issuer: config.issuer ?? "ConvexAuth",
      digits: config.digits ?? 6,
      period: config.period ?? 30,
    },
  };
}
