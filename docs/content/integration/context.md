---
title: Context Enrichment
description: Zero-boilerplate ctx.auth.userId, groupId, role, and grants via
  convex-helpers.
---

Eliminate per-handler auth boilerplate with `auth.ctx()`. Set up once, and every
query/mutation gets `ctx.auth.userId`, `ctx.auth.groupId`, `ctx.auth.role`, and
`ctx.auth.grants` automatically.

Use this for DB-backed authorization state. For native Convex identity claims
already present on the JWT, prefer `ctx.auth.getUserIdentity()`.

Requires [`convex-helpers`](https://github.com/get-convex/convex-helpers).

This is optional app code layered on top of the minimal auth setup. You do not
need it for normal `convex-auth` installation.

## Setup

Import the configured `auth` value from your single `convex/auth.ts` module for
your query and mutation wrappers. It is the supported context and server
facade; application code does not construct a second auth object.

```ts
// convex/lib/functions.ts
import { customQuery, customMutation } from "convex-helpers/server/customFunctions";
import { query as rawQuery, mutation as rawMutation } from "../_generated/server";
import { auth } from "../auth";

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
current session, user document, active membership, and group through one
component query, then derives the configured grants from that snapshot. This is
the appropriate layer for ownership checks and product authorization because it
provides current component state rather than only the token snapshot. The
snapshot is deliberately read again when a Convex query is re-evaluated; roles,
grants, group preference, and session revocation are never hidden behind a
persistent application cache.

The integration keeps protocol registration and application authorization
separate without creating competing auth runtimes. `convex/convex.config.ts`
registers the component. `convex/auth.ts` configures providers and exports the
one auth facade used by both server functions and HTTP routes.
`convex/auth.config.ts` configures native JWT trust, while `convex/http.ts`
mounts protocol routes with `auth.http()`.

Use `auth.ctx()` for protected query and mutation builders, `auth.context(ctx)`
when a server function needs the same snapshot directly, and
`auth.request.context(ctx, request)` only for raw HTTP handlers. These are
methods on one configured facade, so credentials, provider settings, sessions,
and authorization state cannot drift apart.

[In this repo](https://github.com/estifanos-sh/convex-auth/tree/main/convex),
`convex/comments.ts`, `convex/projects.ts`, `convex/issues.ts`, `convex/groups.ts`,
and `convex/account.ts` all import `auth` from `convex/auth.ts`. App-specific
HTTP routes use that same value when they need `auth.request.context(ctx, request)`.

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

Keep the enriched context inside the handler boundary. The middleware infers
its exact type from `auth.ctx()`, including branded IDs and fields returned by
`resolve`, so application code should use `ctx.auth` directly instead of
exporting a parallel `AppAuth` type.

Domain helpers should receive the smallest values they actually need. Assert a
grant at the boundary, then pass a user ID, group ID, or validated domain input
to the helper. Passing the entire auth context through application layers makes
authorization ownership unclear and encourages app-specific wrappers around
the library.

```ts
export const updateDocument = mutation({
  args: { id: v.id("documents"), title: v.string() },
  handler: async (ctx, args) => {
    ctx.auth.assert("documents.update");
    return updateDocumentTitle(ctx, {
      documentId: args.id,
      actorId: ctx.auth.userId,
      title: args.title,
    });
  },
});
```

## The resolved snapshot

Required context carries the branded auth `userId`, the full user document,
and `getUserIdentity()` for the native Convex claims. When the user has an
active group it also carries the branded `groupId`, membership role, and
resolved grants; those fields are `null` or empty when no group is active. Any
fields returned by `resolve()` are added to the same inferred object.

Optional context has the same shape but allows a missing user. Keep that
possibility at the public-function boundary rather than weakening the type of
every protected handler.

## Testing with `convex-test`

The [testing guide](/guides/testing) shows how to register the component and
create real users, memberships, sessions, and `t.withIdentity` claims through
the typed fixture surface. Do not invent session IDs or cast strings to auth
component IDs; those tests skip the exact expiry and revocation behavior they
are supposed to protect.
