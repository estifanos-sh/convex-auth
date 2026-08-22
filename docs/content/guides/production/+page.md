---
title: Production deployment
description: Move a Convex Auth application from local development to production.
---

<svelte:head>

  <title>Production deployment</title>
</svelte:head>

# Production deployment

A production deployment uses the same component and application code as local
development. What changes is the trust boundary: signing keys must be generated
for the production deployment, provider credentials must name production
callbacks, and the public application URL must be the origin users actually
visit.

Generate the production key material with the setup CLI:

```bash
npx convex-auth --prod --app-url "https://myapp.com"
```

The CLI writes the signing and encryption material to the Convex deployment. Do
not copy development keys into production or store them in source control. Set
the provider credentials owned by your application through Convex as well:

```bash
npx convex env set --prod GITHUB_CLIENT_ID "..."
npx convex env set --prod GITHUB_CLIENT_SECRET "..."
```

Then deploy the application and its Convex functions using the build command for
your app:

```bash
npx convex deploy --cmd 'npm run build'
```

## Verify the trust chain

`APP_URL` must be the production frontend origin. Convex provides
`CONVEX_SITE_URL`; `convex/auth.config.ts` must trust its `/auth` issuer with
`applicationID: "convex"`. Every OAuth provider registration must send its
callback to that same production site URL. These values describe one round
trip, so a staging origin, localhost callback, or mismatched issuer will fail
even when each value looks valid in isolation.

`AUTH_KEYS` must exist on the production deployment, and every enabled provider
must receive the credentials that its factory expects. Convex Auth does not use
generic `AUTH_*` provider variables automatically; the names are the ones your
application declared and passed to the provider.

## Publish platform association files

Native passkeys and app links require the frontend host to publish platform
association documents. iOS uses
`/.well-known/apple-app-site-association` with no extension and no redirect;
Android uses `/.well-known/assetlinks.json`. Both must be served from the host
used as the WebAuthn relying-party ID. Configure `IOS_APP_IDS` and
`ANDROID_APP_LINKS` with the applications that are allowed to claim that host.

Password-manager integration can publish `/.well-known/change-password`, and a
security contact can publish `/.well-known/security.txt`. These endpoints are
described in the [.well-known reference](/reference/well-known), but they should
be deployed only when the corresponding application behavior exists.

## Understand refresh traffic

The browser client periodically exchanges its stored refresh token for a short
lived access token. Convex logs may show an `auth:signIn` action followed by an
`auth:store` mutation during page load, token refresh, or activity in another
tab. That pair is normal and does not represent a fresh interactive sign-in.

A refresh can cause active Convex subscriptions to re-evaluate. If one refresh
produces a large burst of query work, look for the same query subscribed in both
a page and its child, auth-dependent queries mounted on routes that do not need
them, or queries that should use `"skip"` until their inputs exist. Pass already
loaded data down the component tree instead of opening another subscription.

Repeated refreshes in a tight loop from one tab are different. They usually
indicate more than one auth client, unavailable or corrupted token storage, or a
proxy retrying a failed exchange. Diagnose that loop at the client and storage
boundary rather than adding application-owned session state.
