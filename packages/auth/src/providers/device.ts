/**
 * Device authorization provider (RFC 8628).
 *
 * Enables input-constrained devices (CLIs, TVs, IoT) to authenticate
 * by displaying a short code that the user enters on a secondary device.
 *
 * ```ts
 * import { device } from "@estifanos-sh/convex-auth/providers/device";
 *
 * device()
 * ```
 *
 * @module
 */

import type { DeviceProviderConfig } from "../server/types";

/** Configuration for the {@link device} provider. */
export interface DeviceConfig {
  /** Character set used to generate the short user code. */
  charset?: string;
  /** Number of characters in the generated user code. */
  userCodeLength?: number;
  /** Device code lifetime in seconds. */
  expiresIn?: number;
  /** Polling interval in seconds suggested to the device client. */
  interval?: number;
  /** Verification page URL shown to the user on the device. */
  verificationUri?: string;
}

const DEFAULT_CHARSET = "BCDFGHJKLMNPQRSTVWXZ";

/**
 * Create a device authorization provider.
 *
 * @param config - Optional device flow code and polling settings.
 * @returns A configured device flow provider for `defineAuth`.
 *
 * @example
 * ```ts
 * import { device } from "@estifanos-sh/convex-auth/providers/device";
 *
 * device({ verificationUri: "https://example.com/device" })
 * ```
 */
export function device(config: DeviceConfig = {}): DeviceProviderConfig {
  return {
    id: "device",
    type: "device",
    charset: config.charset ?? DEFAULT_CHARSET,
    userCodeLength: config.userCodeLength ?? 8,
    expiresIn: config.expiresIn ?? 900,
    interval: config.interval ?? 5,
    verificationUri: config.verificationUri,
  };
}
