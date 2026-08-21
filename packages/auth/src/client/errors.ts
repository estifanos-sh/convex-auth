/**
 * Client-side error-code registry.
 *
 * Re-exports the shared {@link ErrorCode} registry and adds the handshake codes
 * that are meaningful only in the client (they describe the browser⇄Convex
 * confirmation handshake, not a server outcome), so client code has a single
 * import surface for every code it can surface.
 *
 * @module
 */

import { ConvexError, Value } from "convex/values";

import { ErrorCode } from "../shared/codes";

export { ErrorCode };
export type { ErrorCode as ErrorCodeValue } from "../shared/codes";

/**
 * Codes emitted only by the client during the Convex confirmation handshake.
 */
export const HandshakeErrorCode = {
  AUTH_HANDSHAKE_TIMEOUT: "AUTH_HANDSHAKE_TIMEOUT",
  AUTH_HANDSHAKE_REJECTED: "AUTH_HANDSHAKE_REJECTED",
} as const;

/** Union of every client-only handshake code. */
export type HandshakeErrorCode = (typeof HandshakeErrorCode)[keyof typeof HandshakeErrorCode];

type HandshakeErrorContext = Record<string, Value | undefined>;

const HANDSHAKE_ERROR_MESSAGES = {
  AUTH_HANDSHAKE_TIMEOUT: "Sign-in succeeded but authentication confirmation timed out.",
  AUTH_HANDSHAKE_REJECTED: "Authentication was rejected while confirming the session.",
} as const satisfies Record<HandshakeErrorCode, string>;

type HandshakeErrorData = {
  code: HandshakeErrorCode;
  message: string;
} & Record<string, Value>;

/** @internal */
export const createHandshakeError = (code: HandshakeErrorCode, context: HandshakeErrorContext) => {
  const data: HandshakeErrorData = {
    code,
    message: HANDSHAKE_ERROR_MESSAGES[code],
  };
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) data[key] = value;
  }
  return new ConvexError(data);
};
