/**
 * Server-side entrypoint for `@estifanos-sh/convex-auth/server`.
 *
 * Re-exports the public helpers, types, and HTTP integration utilities used to
 * configure Convex Auth on the backend.
 *
 * @module
 */

import "./identity/convex";

export { defineAuth } from "./auth";
export type {
  AuthContext,
  AuthContextConfig,
  AuthConfig,
  AuthExtendValidators,
  OptionalAuthContext,
} from "./auth";
export { vAuthId } from "./validators";
export { authEvents } from "./events";
export type {
  AuthEvent,
  AuthEventHandlerMap,
  AuthEventKind,
  AuthEventTarget,
  AuthEventWhere,
} from "./events";
export type { HttpAuthContext, HttpAuthContextConfig, OptionalHttpAuthContext } from "./http";
export {
  corsHeaders,
  corsPreflightHandler,
  registerCorsPreflight,
  withCors,
  withCorsResponse,
} from "./cors";
export type { McpToolDef } from "./mcp";
export type {
  AuthCookie,
  AuthCookieConfig,
  AuthCookies,
  PreloadResult,
  ServerOptions,
} from "./preload";
export {
  authCookieNames,
  parseAuthCookies,
  serializeAuthCookies,
  server,
  shouldProxyAuthAction,
  structuredAuthCookies,
} from "./preload";
export { wellKnown } from "./wellknown";
export type { WellKnownEndpoint, WellKnownOptions, WellKnownResponse } from "./wellknown";
export type { Grant, PermissionsConfig, RoleId } from "./types";
