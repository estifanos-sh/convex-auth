---
title: SSR Overview
description: Server-side authentication with httpOnly cookies, OAuth code exchange, and
  token refresh.
---

<svelte:head>

  <title>SSR Overview - convex-auth</title>
</svelte:head>

# SSR Overview

The `server()` helper from `@estifanos-sh/convex-auth/server` gives your SSR
framework a single entry point for OAuth code exchange, token refresh, and
httpOnly cookie management. It works with any framework that gives you access to
the incoming `Request` object.

## Basic usage

```ts
import { server } from "@estifanos-sh/convex-auth/server";

const auth = server({ url: process.env.CONVEX_URL! });

// In your server handler / middleware:
const result = await auth.refresh(request);

if (result.redirect) {
  return result.response;
}

const { cookies, token } = result;
```

`auth.refresh(request)` reads the auth cookies from the incoming request,
exchanges or refreshes tokens with your Convex backend, and returns either a
ready-made redirect `Response` or the cookies and token needed to continue the
current SSR response.

## Return shape

`auth.refresh(request)` returns a discriminated union:

### Redirect branch

```ts
{ redirect: true, response: Response }
```

When OAuth code exchange occurs, Convex Auth builds the redirect `Response`
including any `Set-Cookie` headers for you. Return `response` directly from your
framework handler.

### Non-redirect branch

```ts
{ redirect: false, cookies: AuthCookie[], token: string | null }
```

When no redirect is needed, apply `cookies` to the outgoing response and use
`token` for SSR hydration or server-side Convex calls.

Each `AuthCookie` object contains `name`, `value`, and standard cookie options
(`httpOnly`, `secure`, `sameSite`, `path`, `maxAge`). How you apply them depends
on your framework — see the framework-specific guides.

## Proxying client requests

For client-side sign-in and sign-out flows, use `auth.proxy()` to forward POST
requests to your Convex backend:

```ts
const response = await auth.proxy(request);
```

`proxy()` handles:

**Sign-in** — forwards credentials to Convex, returns `Set-Cookie` headers with the new session tokens; **Sign-out** — clears the session on the backend and returns cookie-clearing headers.

Mount this behind a `/api/auth` route (or similar) and point your client-side
auth calls to that endpoint.

## Options

### `acceptedIssuers`

By default, `server()` only accepts tokens issued by your Convex deployment. If
you need to accept tokens from additional issuers (e.g. a custom OIDC provider),
pass them in the `acceptedIssuers` array:

```ts
const auth = server({
  url: process.env.CONVEX_URL!,
  acceptedIssuers: ["https://auth.example.com"],
});
```

## Client-side auth

The `client()` function from `@estifanos-sh/convex-auth/browser` creates the
client-side auth state manager. It works with any Convex client transport.

Use `@estifanos-sh/convex-auth/browser` for browser apps and SSR frameworks because
it wires in browser defaults like URL handling, local storage, sync, and WebAuthn
support. Use `@estifanos-sh/convex-auth/client` only when you need the
framework-agnostic client in a non-browser runtime or want to provide those
runtime pieces yourself.

The client boots by reading its `storage` synchronously at construction, so a
returning SPA session can render authenticated on the first paint. For SSR, pass
the server-known token via the `token` option so hydration starts from the same
resolved state — no synthetic storage required:

```ts
import { client as createAuthClient } from "@estifanos-sh/convex-auth/browser";

const auth = createAuthClient({
  convex: convexClient,
  proxyPath: "/api/auth",
  token: serverToken, // seeds the synchronous boot; may be null
  location: () => currentUrl, // SSR-safe URL source
});
```

A non-empty `token` starts signed in. `token: null` starts signed out and skips
storage/proxy discovery. Omit `token` entirely for the normal SPA path that
discovers persisted auth from storage.

### `location` option

Pass a URL source so the client can safely read query parameters during SSR
(where `window` is not available). Each framework provides this differently:

In SvelteKit, return `page.url` from `$app/state`. In Next.js, pass the URL from
server props or `useSearchParams()`. TanStack Start can provide it through a
server function or loader. A browser-only SPA can omit the option because the
client safely falls back to `window.location`.

### `auth.param(name)`

SSR-safe URL parameter reader. Uses the `location` option, falls back to
`window.location` when available:

```ts
const workspaceId = auth.param("workspace");
```

### `auth.invite`

The client automatically detects invite tokens from `?invite=` URL parameters
and persists them across OAuth redirects. After authentication, the app can
consume the invite:

```ts
if (auth.invite) {
  const { token } = await auth.invite.accept();
  // Use the token to call your accept mutation
  await client.mutation(api.acceptInvite, { token });
}
```

The client reads `?invite=` and `?email=` from the URL and persists the token
before sign-in so it survives an OAuth redirect. After the provider returns, it
recovers the same token. Accepting the invite clears the stored value and
removes the URL parameters, which keeps this transient credential out of later
navigation and copied links.

## Next steps

See the framework-specific guides for full integration examples:

Continue with the framework guide for [SvelteKit](/ssr/sveltekit/),
[TanStack Start](/ssr/tanstack/), or [Next.js](/ssr/nextjs/).
