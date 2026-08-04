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

Import from `@robelest/convex-auth/core` for your query and mutation wrappers.
This keeps provider, OAuth, and crypto code out of your query bundles entirely.

```ts
// convex/auth/core.ts
import { createAuthContext } from "@robelest/convex-auth/core";
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

Use `ctx.auth.getUserIdentity()` when you want the native Convex identity
surface directly from the JWT:

- `subject`
- `tokenIdentifier`
- `email`
- `name`
- `pictureUrl`

Use `auth.ctx()` when you want auth state enriched from Convex Auth tables:

- `ctx.auth.userId`
- `ctx.auth.user`
- `ctx.auth.groupId`
- `ctx.auth.role`
- `ctx.auth.grants`

The canonical `convex-auth` integration uses:

- `convex/convex.config.ts` — component registration
- `convex/auth.ts` — provider config, exports `signIn`/`signOut` plus the internal `store` and `http` runtime aliases
- `convex/auth/core.ts` — lightweight context for queries/mutations
- `convex/auth.config.ts` — native Convex JWT trust config
- `convex/http.ts` — mounts auth protocol routes with `auth.http()`

## When to use `core` vs `auth`

Use `convex/auth/core.ts` anywhere you only need auth context or helper
lookups inside Convex functions.

- Queries and mutations wrapped with `auth.ctx()`
- Permission checks like `auth.member.assert(ctx, ...)`
- Helper lookups like `auth.user.get`, `auth.member.list`, `auth.group.get`
- Account, factor, and key management like `auth.account.list`,
  `auth.factor.list`, and `auth.key.list`

Use `convex/auth.ts` only for the full runtime surface.

- Exporting `signIn`, `signOut`, `store`, and `http`
- Calling `auth.request.context(ctx, request)`
- Passing the full auth runtime into higher-level server helpers such as group SSO setup

[In this repo](https://github.com/robelest/convex-auth/tree/main/convex), `convex/comments.ts`, `convex/projects.ts`, `convex/issues.ts`,
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
import { register } from "@robelest/convex-auth/test";
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
