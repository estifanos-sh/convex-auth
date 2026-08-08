/**
 * Email (magic link / OTP) authentication provider.
 *
 * @module
 */

import type { AnyDataModel, GenericActionCtx } from "convex/server";

import { defaultMagicLinkEmail } from "../server/templates";
import type { EmailConfig } from "../server/types";

/** Configuration for the {@link email} provider. */
export interface EmailProviderConfig {
  /** Sender address used for outgoing verification emails. */
  from: string;
  /** Delivery callback that actually sends the rendered verification email. */
  send: (
    ctx: GenericActionCtx<AnyDataModel>,
    opts: { from: string; to: string; subject: string; html: string },
  ) => Promise<void>;
  /** Optional custom token generator for OTP or magic-link flows. */
  generateVerificationToken?: () => Promise<string>;
  /** Stable provider identifier used in `signIn("<id>")`. */
  id?: string;
  /** Verification token lifetime in seconds. */
  maxAge?: number;
}

/**
 * Create an email magic link or OTP provider.
 *
 * @param config - Sender identity and delivery hooks for verification emails.
 * @returns A configured email provider for `defineAuth`.
 * @throws {Error} When `from` is empty.
 *
 * @example
 * ```ts
 * import { email } from "@estifanos-sh/convex-auth/providers";
 *
 * email({
 *   from: "My App <noreply@example.com>",
 *   send: async (_ctx, message) => {
 *     await resend.emails.send(message);
 *   },
 * })
 * ```
 */
export function email(config: EmailProviderConfig): EmailConfig {
  const from = config.from.trim();
  if (from.length === 0) {
    throw new Error(
      "Email provider requires a non-empty `from` address " +
        '(for example, `"My App <noreply@example.com>"`).',
    );
  }
  const { send } = config;
  const { generateVerificationToken } = config;
  return {
    id: config.id ?? "email",
    type: "email",
    name: "Email",
    from,
    maxAge: config.maxAge ?? 60 * 60 * 24,
    authorize: undefined,
    sendVerificationRequest: async ({ identifier, url }, ctx) => {
      if (!ctx) {
        throw new Error("Email provider requires a Convex action context.");
      }
      const { host } = new URL(url);
      await send(ctx, {
        from,
        to: identifier,
        subject: `Sign in to ${host}`,
        html: defaultMagicLinkEmail(url, host),
      });
    },
    generateVerificationToken,
    options: { from },
  };
}
