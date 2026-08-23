import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { jsonError } from "./response";

import type { OAuthClientDoc } from "./client";
import { checkOAuthGrant } from "./grant";

/** Dependencies injected by the runtime into the authorize handler. */
export interface OAuthAuthorizeDeps {
  getClient: (
    ctx: GenericActionCtx<GenericDataModel>,
    clientId: string,
  ) => Promise<OAuthClientDoc | null>;
  /** Path of the app's headless consent page (e.g. `/oauth/authorize`). */
  consentPage: string;
  /** Returns the auth site base URL (e.g. `https://example.com/auth`). */
  authSiteUrl: () => string;
}

/**
 * Validate an RFC 8707 `resource` indicator: it must be an absolute URI with an
 * `http`/`https` scheme and no fragment. The value is an audience identifier for
 * the protected resource (e.g. the MCP endpoint URL), not a fetch target.
 *
 * @see https://www.rfc-editor.org/rfc/rfc8707
 */
function isValidResourceIndicator(resource: string): boolean {
  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    return false;
  }
  if (url.hash !== "") return false;
  return url.protocol === "https:" || url.protocol === "http:";
}

/**
 * Redirect an OAuth error back to a registered `redirect_uri`. The parse is
 * guarded so a malformed (yet registered) URI yields a 400 rather than a 500.
 */
function oauthError(redirectUri: string, error: string, state?: string | null): Response {
  try {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    if (state) url.searchParams.set("state", state);
    return Response.redirect(url.toString(), 302);
  } catch {
    return jsonError(400, "invalid_request", "Invalid redirect_uri.");
  }
}

/**
 * Build the `GET /oauth2/authorize` request handler.
 *
 * The client and `redirect_uri` registration are validated before any redirect:
 * an unknown client or unregistered `redirect_uri` yields a direct error
 * response, never a redirect, to avoid an open redirect (RFC 6749 §3.1.2.4,
 * RFC 9700). Only once `redirect_uri` is a registered value are subsequent
 * validation failures surfaced back via redirect. Requires PKCE `S256`. The
 * client-grant predicate is shared with the consent mutation and token endpoint
 * via {@link checkOAuthGrant}; only the error formatting differs per boundary.
 *
 * @see https://www.rfc-editor.org/rfc/rfc6749#section-3.1.2.4
 * @see https://www.rfc-editor.org/rfc/rfc9700
 * @internal
 */
export function createAuthorizeHandler(deps: OAuthAuthorizeDeps) {
  return async (ctx: GenericActionCtx<GenericDataModel>, request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const p = url.searchParams;

    const clientId = p.get("client_id");
    const redirectUri = p.get("redirect_uri");
    const responseType = p.get("response_type");
    const scope = p.get("scope") ?? "";
    const state = p.get("state");
    const codeChallenge = p.get("code_challenge");
    const codeChallengeMethod = p.get("code_challenge_method");
    const resource = p.get("resource");

    if (!clientId || !redirectUri || !codeChallenge) {
      return jsonError(400, "invalid_request", "Missing required parameter.");
    }

    const client = await deps.getClient(ctx, clientId);
    const requestedScopes = scope ? scope.split(" ").filter(Boolean) : [];
    const check = checkOAuthGrant({
      client,
      grantType: "authorization_code",
      redirectUri,
      requestedScopes,
    });

    if (!check.ok && check.denial.reason === "client_not_found") {
      return jsonError(401, "invalid_client", "Unknown or inactive client.");
    }
    if (!check.ok && check.denial.reason === "redirect_uri_mismatch") {
      return jsonError(400, "invalid_request", "redirect_uri mismatch.");
    }
    if (responseType !== "code") {
      return oauthError(redirectUri, "unsupported_response_type", state);
    }
    if (codeChallengeMethod !== "S256") {
      return oauthError(redirectUri, "invalid_request", state);
    }
    if (!check.ok && check.denial.reason === "grant_type_not_allowed") {
      return oauthError(redirectUri, "unauthorized_client", state);
    }
    if (!check.ok && check.denial.reason === "scope_not_allowed") {
      return oauthError(redirectUri, "invalid_scope", state);
    }
    if (resource !== null && !isValidResourceIndicator(resource)) {
      return oauthError(redirectUri, "invalid_target", state);
    }

    const authorizeUrl = new URL(deps.consentPage, deps.authSiteUrl());
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("scope", scope);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    if (state) authorizeUrl.searchParams.set("state", state);
    if (resource !== null) authorizeUrl.searchParams.set("resource", resource);

    return Response.redirect(authorizeUrl.toString(), 302);
  };
}
