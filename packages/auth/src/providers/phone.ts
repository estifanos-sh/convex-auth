/**
 * Phone / SMS authentication provider.
 *
 * @module
 */

import type { GenericDataModel } from "convex/server";

import type { PhoneConfig } from "../server/types";

/** Configuration for the {@link phone} provider. */
export interface PhoneProviderConfig<Id extends string = "phone"> {
  /** SMS or phone delivery callback for verification tokens. */
  send: PhoneConfig["sendVerificationRequest"];
  /** Stable provider identifier used in `signIn("<id>")`. */
  id?: Id;
  /** Verification token lifetime in seconds. */
  maxAge?: number;
}

/**
 * Create a phone or SMS verification provider.
 *
 * @param config - SMS delivery hook and optional provider settings.
 * @returns A configured phone provider for `defineAuth`.
 *
 * @example
 * ```ts
 * import { phone } from "@estifanos-sh/convex-auth/providers";
 *
 * phone({
 *   send: async ({ identifier, token }) => {
 *     await sendSms(identifier, `Your sign-in code is ${token}`);
 *   },
 * })
 * ```
 */
export function phone<const Id extends string = "phone">(
  config: PhoneProviderConfig<Id>,
): PhoneConfig<GenericDataModel, Id> {
  return {
    id: (config.id ?? "phone") as Id,
    type: "phone",
    maxAge: config.maxAge ?? 60 * 20,
    authorize: async (params, account) => {
      if (typeof params.phone !== "string") {
        throw new Error("Token verification requires a `phone` in params of `signIn`.");
      }
      if (account.providerAccountId !== params.phone) {
        throw new Error(
          "Short verification code requires a matching `phone` " + "in params of `signIn`.",
        );
      }
    },
    sendVerificationRequest: config.send,
    options: {},
  };
}
