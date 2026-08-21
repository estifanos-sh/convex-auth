---
title: Context Enrichment
description: Zero-boilerplate ctx.auth.userId, groupId, role, and grants via
  convex-helpers.
---

<svelte:head>

  <title>Context Enrichment - convex-auth</title>
</svelte:head>

# Context Enrichment

Eliminate per-handler auth boilerplate with `auth.ctx()`. Set up once, and every
query/mutation gets `ctx.auth.userId`, `ctx.auth.groupId`, `ctx.auth.role`, and
`ctx.auth.grants` automatically.

Use this for DB-backed authorization state. For native Convex identity claims
already present on the JWT, prefer `ctx.auth.getUserIdentity()`.

Requires [`convex-helpers`](https://github.com/get-convex/convex-helpers).

This is optional app code layered on top of the minimal auth setup. You do not
need it for normal `convex-auth` installation.

## Setup

Import from `@estifanos-sh/convex-auth/core` for your query and mutation wrappers.
This keeps provider, OAuth, and crypto code out of your query bundles entirely.

```ts
// convex/auth/core.ts
import { createAuthContext } from "@estifanos-sh/convex-auth/core";
import { components } from "../_generated/api";

export const auth = createAuthContext(components.auth);
```

```ts
// convex/lib/functions.ts
import { customQuery, customMutation } from "convex-helpers/server/customFunctions";
import { query as rawQuery, mutation as rawMutation } from "../_generated/server";
import { auth } from "../auth/core";

const authCtx = auth.ctx();

export const query = customQuery(rawQuery, authCtx);
export const mutation = customMutation(rawMutation, authCtx);
```

## Usage

```ts
// convex/chat.ts
import { query, mutation } from "./lib/functions";

export const list = query({
  args: {},
  handler: async (ctx) => {
    // ctx.auth.userId — authenticated user ID
    // ctx.auth.user   — full user document
    // ctx.auth.grants — resolved grant strings for the active group
    return ctx.db.query("messages").collect();
  },
});
```

## Identity vs enrichment

Use `ctx.auth.getUserIdentity()` when a function needs only the native claims
Convex verified from the JWT, such as its subject, token identifier, email,
name, or picture URL. Those claims are a signed snapshot and require no lookup
of the auth user.

Use `auth.ctx()` for application functions. It resolves the stable `userId` and
current user document, then adds the active group, role, and grants when that
context exists. This is the appropriate layer for ownership checks and product
authorization because it provides the current component state rather than only
the token snapshot.

The integration keeps those responsibilities in separate files.
`convex/convex.config.ts` registers the component, `convex/auth.ts` configures
providers and exports the auth runtime, and `convex/auth/core.ts` creates the
lightweight context used by application functions. `convex/auth.config.ts`
configures native JWT trust, while `convex/http.ts` mounts protocol routes with
`auth.http()`.

## When to use `core` vs `auth`

Use `convex/auth/core.ts` anywhere a query or mutation needs `auth.ctx()`, a
permission assertion, an entity lookup, or current-user management of accounts,
factors, and keys. It deliberately excludes provider implementations and crypto
from those function bundles.

Import the full runtime from `convex/auth.ts` only at boundaries that actually
drive authentication: exporting `signIn`, `signOut`, and `store`; mounting HTTP
routes; resolving credentials on a raw HTTP request; or configuring a server
integration that needs providers. This split is a bundling boundary, not two
different auth systems.

[In this repo](https://github.com/estifanos-sh/convex-auth/tree/main/convex), `convex/comments.ts`, `convex/projects.ts`, `convex/issues.ts`,
`convex/groups.ts`, and `convex/account.ts` all use `core` because they only
need `ctx.auth` and helper APIs. App-specific HTTP routes still import
`auth.ts` when they need `auth.request.context(ctx, request)`.

## Optional auth (public routes)

```ts
export const publicQuery = customQuery(rawQuery, auth.ctx.optional());
// ctx.auth.userId is null and ctx.auth.grants is [] when unauthenticated
```

Use `auth.context.optional(ctx)` for the same null-shaped resolution outside
of a `customQuery` setup:

```ts
const c = await auth.context.optional(ctx);
if (c.userId === null) {
  // unauthenticated path
}
```

## Add app-specific fields

```ts
const authCtx = auth.ctx({
  resolve: async (_ctx, user, authState) => {
    return {
      activeGroupId: authState.groupId ?? null,
      canManageMembers: authState.grants.includes("members.create"),
    };
  },
});
// ctx.auth.groupId, ctx.auth.role, ctx.auth.grants,
// and ctx.auth.canManageMembers available in all handlers
```

## What's on `ctx.auth`

| Property            | Type                            | Description                            |
| ------------------- | ------------------------------- | -------------------------------------- |
| `userId`            | `string`                        | Authenticated user's document ID       |
| `user`              | `object \| null`                | Full user document                     |
| `groupId`           | `string \| null`                | Active group ID                        |
| `role`              | `string \| null`                | Primary role for active group          |
| `grants`            | `string[]`                      | Resolved grants for active group       |
| `getUserIdentity()` | `Promise<UserIdentity \| null>` | Native Convex identity from JWT claims |
| `...extra`          | varies                          | Whatever `resolve()` returns           |

## Testing with `convex-test`

You can test `auth.ctx()`-based functions with
[`convex-test`](https://docs.convex.dev/testing). Register the Convex Auth
component in your test harness so component-backed user, member, and group
lookups behave the same way as production.

### Register the component

Make sure your `convex-test` harness mounts the Convex Auth component before
invoking wrappers that call `auth.ctx()` or `auth.context(...)`.

```ts
// convex/test.setup.ts
import { convexTest } from "convex-test";
import { register } from "@estifanos-sh/convex-auth/test";
import schema from "./schema";

export function setupTest() {
  const t = convexTest(schema);
  register(t);
  return t;
}
```

For handlers that only need the current identity, prefer native Convex auth in
the handler instead of `auth.ctx()`:

```ts
const identity = await ctx.auth.getUserIdentity();
if (!identity) throw new Error("Authentication required");
const userId = identity.subject;
```
