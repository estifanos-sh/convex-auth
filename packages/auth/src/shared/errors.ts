/**
 * Error types shared between client, server, and the Convex component.
 *
 * Lives in `shared/` rather than `server/` because the component layer must be
 * able to raise structured auth errors, and `component/` never imports from
 * `server/`.
 *
 * @module
 */

import { ConvexError } from "convex/values";

import type { ErrorCode } from "./codes";

/** Error raised during a sign-in flow, carrying a machine-readable `code`. */
export class AuthFlowError extends Error {
  readonly code: string;

  constructor({ code, message }: { readonly code: string; readonly message: string }) {
    super(message);
    this.code = code;
    this.name = "AuthFlowError";
  }
}

/** @internal */
export const authFlowError = (code: string, message: string) =>
  new AuthFlowError({ code, message });

export type AuthErrorData = {
  code: ErrorCode;
  message: string;
};

/**
 * Build a `ConvexError` carrying an auth error `code` and `message`, plus any
 * extra structured fields.
 * @internal
 */
export const convexError = (
  code: ErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): ConvexError<AuthErrorData> => new ConvexError({ code, message, ...extra });
