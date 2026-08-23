import { ConvexError } from "convex/values";

import { ErrorCode } from "../shared/codes";
import { AuthFlowError, authFlowError } from "../shared/errors";

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

/**
 * Render an unknown thrown value as a short, human-readable fragment for an
 * error message. Strings are JSON-quoted so an empty string stays visible,
 * primitives stringify, and everything else JSON-encodes — falling back to
 * `Object#toString` for values `JSON.stringify` returns `undefined` for.
 *
 * @internal
 */
export const describeUnknown = (value: unknown) => {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    value === null
  ) {
    return String(value);
  }
  const json = JSON.stringify(value);
  return json ?? Object.prototype.toString.call(value);
};

/** @internal */
export const toConvexError = (error: unknown): ConvexError<AuthErrorData> => {
  if (error instanceof ConvexError) {
    return error as ConvexError<AuthErrorData>;
  }
  if (error instanceof AuthFlowError) {
    /**
     * `AuthFlowError.code` is the wider client/server flow-code space (e.g. the
     * RFC 8628 device codes `DEVICE_SLOW_DOWN`/`DEVICE_AUTHORIZATION_PENDING`),
     * which is a superset of the {@link ErrorCode} registry. This is the single
     * adapter that bridges that wider space into {@link AuthErrorData}.
     */
    return new ConvexError({ code: error.code as ErrorCode, message: error.message });
  }
  return new ConvexError({
    code: ErrorCode.INTERNAL_ERROR,
    message: error instanceof Error ? error.message : String(error),
  });
};

/**
 * Normalize a caught value into a `ConvexError` carrying `code`.
 *
 * An already-structured `ConvexError` passes through untouched; a plain
 * `Error` keeps its own message (falling back to `message` when empty);
 * anything else becomes `code`/`message`. Used by the passkey and TOTP
 * ceremony handlers, which must never let a value thrown by a provider
 * callback escape as an opaque failure.
 *
 * @internal
 */
/**
 * The canonical "there is no authenticated user" error.
 *
 * Ten call sites across the HTTP surface, the facade, and the domain helpers
 * had inlined this same `{ code, message }` pair; naming it keeps the wire
 * `message` identical everywhere a caller has to distinguish "not signed in"
 * from a permission failure.
 *
 * @internal
 */
export const notSignedInError = (
  message = "Authentication required.",
): ConvexError<AuthErrorData> => convexError(ErrorCode.NOT_SIGNED_IN, message);

export const asConvexError = (
  error: unknown,
  code: ErrorCode,
  message: string,
): ConvexError<AuthErrorData> =>
  error instanceof ConvexError
    ? (error as ConvexError<AuthErrorData>)
    : error instanceof Error
      ? toConvexError(authFlowError(code, error.message || message))
      : convexError(code, message);
