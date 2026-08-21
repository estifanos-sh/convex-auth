---
title: One identity, every client
description: Use one user identity across browser, device, SSO, and API access.
---

<svelte:head>

  <title>One identity, every client</title>
</svelte:head>

# One identity, every client

The way a caller proves identity should not change the shape of your product
code. Browser sessions, OAuth, passwords, passkeys, group SSO, and device flow
all resolve to the same Convex Auth `userId`. Your queries and mutations consume
that identity through `ctx.auth`; they do not need a provider-specific adapter.

Create the authenticated builders once:

```ts
// convex/functions.ts
export const authQuery = customQuery(query, auth.ctx());
export const authMutation = customMutation(mutation, auth.ctx());
```

Every protected function can then operate on the current user without accepting
an identity from the client or looking up a provider account.

```ts
export const listMine = authQuery({
  args: {},
  handler: (ctx) =>
    ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", ctx.auth.userId))
      .collect(),
});
```

Group SSO and device authorization eventually issue the same kind of session as
an interactive browser sign-in. Do not create separate user tables or duplicate
handlers for them. The provider and transport differ; the product identity does
not.

## Machine and raw HTTP access

API keys are deliberately different because a raw HTTP request may not carry a
browser session. Use `auth.request.action` for an API-key-only endpoint. Use
`auth.request.context` only when one HTTP route intentionally accepts either an
API key or a browser session.

```ts
const handler = httpAction(async (ctx, request) => {
  const identity = await auth.request.context(ctx, request);
  return Response.json(
    await ctx.runQuery(internal.projects.forOwner, {
      ownerId: identity.userId,
    }),
  );
});
```

Keep the shared business operation keyed by `userId`. The HTTP boundary resolves
the credential once and passes the trusted identity inward. It should not copy
session validation, API-key parsing, or account lookup into domain functions.

If an endpoint only serves the browser, prefer an `authQuery` or `authMutation`.
The raw request helpers are escape hatches for HTTP integrations, not the
default architecture.
