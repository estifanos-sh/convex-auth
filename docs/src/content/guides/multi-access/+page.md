---
title: Multi-Access
description: One app, any auth method — session, API key, SSO, device flow.
---

<svelte:head>

  <title>Multi-Access - convex-auth</title>
</svelte:head>

# Multi-Access

Every auth path resolves to the same `userId`. They compose naturally because
`userId` is the single shared anchor across all access patterns.

## Default app pattern

In app queries, mutations, and actions, use `auth.ctx()` once and then read the
resolved user from `ctx.auth`.

```ts
// convex/functions.ts
export const authQuery = customQuery(query, auth.ctx());
```

```ts
export const myGroups = authQuery({
  args: {},
  handler: async (ctx) => {
    return await auth.member.list(ctx, {
      where: { userId: ctx.auth.userId },
    });
  },
});
```

## Raw HTTP fallback

Most apps do not need `auth.request.context(...)`. Keep it for raw `httpAction`
handlers that intentionally accept either a browser session or an API key in the
same endpoint.

```ts
http.route({
  path: "/api/data",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const authContext = await auth.request.context.optional(ctx, request);
    if (authContext.userId === null) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }
    const data = await ctx.runQuery(internal.data.forUser, {
      userId: authContext.userId,
    });
    return Response.json(data);
  }),
});
```

## How each access pattern resolves

| How the user authenticated                | How `userId` is available                                       |
| ----------------------------------------- | --------------------------------------------------------------- |
| Browser (password, email, passkey, OAuth) | `ctx.auth.userId` via `auth.ctx()`                              |
| Group SSO (OIDC/SAML)                     | Same as browser - SSO completes as a session                    |
| Device flow (RFC 8628, CLI/TV)            | Same as browser - device poll returns session tokens            |
| API key (machine/automation)              | `ctx.key.userId` or `auth.request.context(ctx, request).userId` |

## Composing primitives

```ts
// Works for any authenticated caller
async function getMyGroups(ctx: any, userId: string) {
  const { page } = await auth.member.list(ctx, {
    where: { userId },
    paginationOpts: { numItems: 25, cursor: null },
  });
  return page;
}

// Browser session
const handler = authQuery({
  args: {},
  handler: async (ctx) => {
    return getMyGroups(ctx, ctx.auth.userId);
  },
});

// API key HTTP endpoint
const apiHandler = auth.request.action(async (ctx) => {
  return getMyGroups(ctx, ctx.key.userId);
});

// Any HTTP action (session or API key)
const flexHandler = httpAction(async (ctx, request) => {
  const authContext = await auth.request.context(ctx, request);
  return Response.json(await getMyGroups(ctx, authContext.userId));
});
```
