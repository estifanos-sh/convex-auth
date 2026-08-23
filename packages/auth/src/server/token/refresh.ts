import { GenericId } from "convex/values";

import type { RefreshToken } from "../../shared/brand";
import { ErrorCode } from "../../shared/codes";
import { convexError } from "../errors";
import { maybeRedact } from "../log";
import type { ConvexAuthConfig } from "../types";

export const REFRESH_TOKEN_DIVIDER = "|";

/** @internal Encode the `(refreshTokenId, sessionId)` pair into a refresh token. */
export const encodeRefreshToken = (
  refreshTokenId: GenericId<"RefreshToken">,
  sessionId: GenericId<"Session">,
): RefreshToken => `${refreshTokenId}${REFRESH_TOKEN_DIVIDER}${sessionId}` as RefreshToken;

const DEFAULT_SESSION_INACTIVE_DURATION_MS = 1000 * 60 * 60 * 24 * 30;
/** @internal */
export const REFRESH_TOKEN_REUSE_WINDOW_MS = 10 * 1000;

type ParsedRefreshToken = {
  refreshTokenId: GenericId<"RefreshToken">;
  sessionId: GenericId<"Session">;
};

export const refreshTokenExpirationTime = (config: ConvexAuthConfig, now = Date.now()) =>
  now + (config.session?.inactiveDurationMs ?? DEFAULT_SESSION_INACTIVE_DURATION_MS);

/** @internal */
export const parseRefreshToken = (refreshToken: string): ParsedRefreshToken => {
  const parts = refreshToken.split(REFRESH_TOKEN_DIVIDER);
  const message = `Can't parse refresh token: ${maybeRedact(refreshToken)}`;
  if (parts.length !== 2) {
    throw convexError(ErrorCode.INVALID_REFRESH_TOKEN, message);
  }
  const [refreshTokenId, sessionId] = parts;
  if (refreshTokenId == null || sessionId == null) {
    throw convexError(ErrorCode.INVALID_REFRESH_TOKEN, message);
  }
  return {
    refreshTokenId: refreshTokenId as GenericId<"RefreshToken">,
    sessionId: sessionId as GenericId<"Session">,
  };
};
