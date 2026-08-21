---
title: MCP Server (OAuth 2.1)
description: Expose your Convex app to AI agents as an OAuth 2.1 authorization server and MCP server.
---

<svelte:head>

  <title>MCP Server (OAuth 2.1) - convex-auth</title>
</svelte:head>

# MCP Server (OAuth 2.1)

Turn your Convex deployment into an OAuth 2.1 **authorization server** and an
**MCP server**, so AI agents can call your functions as the signed-in user with
scoped, user-consented access. The library owns every wire endpoint, the
discovery metadata, CORS, PKCE, token rotation, and dynamic client registration
— you write the consent page and the tools.

The tokens an agent receives are `at+jwt` access tokens that are also valid
Convex identities, so an MCP tool's `handler` runs with the user's auth context
and your normal permission checks apply.

## Enable the authorization server

Add an `oauth` block and a non-empty `permissions.grants` set (MCP tool scopes
are drawn from these grants):

```ts
export const { auth } = defineAuth(components.auth, {
  providers: [
    /* ... */
  ],
  permissions: {
    grants: ["projects.read", "issues.create", "members.read"],
    roles: {
      /* ... */
    },
  },
  oauth: {
    pages: {
      // Where the AS sends an unauthenticated browser to sign in.
      login: "/login",
      // Your consent page — shown the requested scopes; it approves the request.
      consent: "/oauth/authorize",
    },
  },
});
```

The AS signs tokens with EdDSA. The CLI stores the required signing and public
verification material in the versioned `AUTH_KEYS` keyring (see
[Environment Variables](/getting-started/environment)):

| Variable    | Purpose                                                             |
| ----------- | ------------------------------------------------------------------- |
| `AUTH_KEYS` | Contains the private EdDSA key and public JWKS served at `jwks_uri` |

The issuer is `CONVEX_SITE_URL` plus the auth path, which defaults to `/auth`.

## Expose tools over MCP

Register tools on your HTTP router with `auth.request.mcp(http, tools, opts?)`.
Each tool is a plain object — `description`, a `scope` (one of your grants),
Convex `args` validators (which become the tool's input schema), and a
`handler` that runs as the authenticated user:

```ts
const http = auth.http();

auth.request.mcp(http, {
  list_projects: {
    description: "List the projects in a workspace.",
    scope: "projects.read",
    args: v.object({ groupId: v.string() }),
    handler: (ctx, a) => ctx.runQuery(api.projects.list, { groupId: a.groupId }),
  },
  create_issue: {
    description: "Create an issue in a project.",
    scope: "issues.create",
    args: v.object({ projectId: v.string(), title: v.string() }),
    handler: (ctx, a) =>
      ctx.runMutation(api.issues.create, { projectId: a.projectId, title: a.title }),
  },
});

export default http;
```

This mounts `POST /mcp` (the JSON-RPC endpoint, plus its bearer challenge) and
`GET /.well-known/oauth-protected-resource` (RFC 9728), which points clients at
your authorization server. A request whose token lacks a tool's `scope` is
rejected before the handler runs.

`opts` accepts `{ name, version, mcpPath }` — pass `mcpPath` if you mount the
MCP endpoint somewhere other than `/mcp`. Registration throws if `oauth` is not
configured or `permissions.grants` is empty.

## Build the consent page

The authorization endpoint redirects the browser to your `oauth.pages.consent`
path with the request parameters. The page shows the requested scopes and, on
approval, records the user's authorization by calling `auth.oauth.authorize` —
which mints a single-use code and returns the redirect back to the client.

`userId` **must** be the authenticated caller, never request input:

```ts
export const authorize = mutation({
  args: {
    clientId: v.string(),
    redirectUri: v.string(),
    scope: v.optional(v.string()),
    state: v.optional(v.string()),
    codeChallenge: v.string(),
    resource: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await auth.user.viewer(ctx);
    if (user === null) throw new ConvexError({ code: "NOT_SIGNED_IN" });

    const result = await auth.oauth.authorize(ctx, {
      userId: user._id,
      clientId: args.clientId,
      scopes: args.scope?.split(" ").filter(Boolean) ?? [],
      redirectUri: args.redirectUri,
      codeChallenge: args.codeChallenge,
      resource: args.resource,
      state: args.state ?? null,
    });

    const redirect = new URL(result.redirectUri);
    redirect.searchParams.set("code", result.code);
    if (result.state) redirect.searchParams.set("state", result.state);
    return { redirect: redirect.toString() };
  },
});
```

`auth.oauth.authorize` validates the `clientId`, the `redirectUri` against the
client's registered URIs, and that every requested scope is one the client
registered for. PKCE (`code_challenge`, `S256`) is mandatory for every client.

## Register clients

### Dynamic Client Registration (RFC 7591)

MCP clients self-register at `POST {prefix}/oauth2/register`. Scopes are clamped
to your `permissions.grants`; `grant_types` are server-fixed to
`["authorization_code", "refresh_token"]`. A client chooses its
`token_endpoint_auth_method`:

Use `none` for a public client such as a CLI or native app that cannot protect a
secret. Convex Auth issues no client secret and requires PKCE as the proof that
the token exchange belongs to the client that began authorization.

Use `client_secret_post` or `client_secret_basic` for a confidential server
client. Convex Auth returns the secret once at registration. The two values
describe how the same credential is presented at the token endpoint;
`client_secret_post` is the default.

```http
POST /auth/oauth2/register
Content-Type: application/json

{
  "client_name": "My agent",
  "redirect_uris": ["https://client.example.com/callback"],
  "scope": "projects.read issues.create",
  "token_endpoint_auth_method": "none"
}
```

The response includes the `client_id`, the `client_secret` (confidential only),
a one-time **`registration_access_token`**, and a `registration_client_uri` for
managing the client. `redirect_uris` must be `https://` or
`http://localhost` / `http://127.0.0.1`.

### Manage a client (RFC 7592)

The `registration_client_uri` (`{prefix}/oauth2/register/{client_id}`) accepts,
authenticated by `Authorization: Bearer {registration_access_token}`:

`GET` returns the client's current registration. `PUT` replaces its mutable
registration and repeats the redirect URI and scope validation performed during
creation. The client ID remains immutable and a client cannot grant itself new
scopes. A confidential client may become public, but turning a public client
into a confidential one requires a new registration so a secret can be issued
through the correct one-time channel.

`DELETE` revokes the registration and returns `204`. New code and refresh-token
exchanges fail immediately. An access token already issued remains valid only
until its short expiration.

The token is bound to its one client: a registration access token for one client
can never read, modify, or delete another.

### Programmatic registration

To register a first-party client yourself (the consumer's own dashboard), call
`auth.oauth.client.create`:

```ts
const { clientId, clientSecret, registrationAccessToken } = await auth.oauth.client.create(ctx, {
  data: {
    name: "Internal agent",
    redirectUris: ["https://app.example.com/callback"],
    scopes: ["projects.read"],
    // tokenEndpointAuthMethod defaults to "client_secret_post"
  },
});
```

`clientSecret` is returned only for confidential clients. The other app-facing
client verbs are `auth.oauth.client.{get, list, update, revoke}`. Secret and
registration-token verification are handled internally by the OAuth endpoints
mounted through `auth.http()`.

## Tokens, scopes, and resource binding

Access tokens are `at+jwt` JWTs valid for 15 minutes. Their `aud` is `"convex"`
so Convex can verify them as identities; `sub` identifies the user, while
`client_id` and `scope` describe the delegated client access.

A client can bind authorization to a resource under RFC 8707. The resource
indicator travels from the authorization request through the code, access
token, and refresh rotation. An MCP endpoint rejects a token bound to a
different canonical resource, which prevents a token minted for one server from
being replayed at another.

Refresh tokens rotate on every use. Replaying an older token outside the short
reuse window is treated as credential theft, revokes the entire chain, and
emits an `oauth.refresh.reuse_detected` audit event.

## Discovery & wire endpoints

Clients discover everything from `GET /.well-known/oauth-authorization-server`
(and `/.well-known/openid-configuration`):

| Endpoint                                       | Purpose                                |
| ---------------------------------------------- | -------------------------------------- |
| `GET {prefix}/oauth2/authorize`                | Authorization-code flow (PKCE `S256`)  |
| `POST {prefix}/oauth2/token`                   | Code exchange + refresh rotation       |
| `POST {prefix}/oauth2/register`                | Dynamic client registration (RFC 7591) |
| `GET/PUT/DELETE {prefix}/oauth2/register/{id}` | Client management (RFC 7592)           |
| `GET /.well-known/oauth-authorization-server`  | AS metadata                            |
| `GET /.well-known/jwks.json`                   | Signing keys                           |
| `POST /mcp`                                    | MCP JSON-RPC (per `auth.request.mcp`)  |
| `GET /.well-known/oauth-protected-resource`    | MCP resource metadata (RFC 9728)       |

The advertised `token_endpoint_auth_methods_supported` is
`["client_secret_post", "client_secret_basic", "none"]`, `grant_types_supported`
is `["authorization_code", "refresh_token", "client_credentials"]`,
`code_challenge_methods_supported` is `["S256"]`, and `scopes_supported` is your
configured grants.
