---
title: auth.user
description: Resolve and manage Convex Auth user identities.
---

The `auth.user` namespace is the server facade for Convex Auth's canonical user
record. Use it for administrative lookup and mutation. Product code should
usually take the current identity from `ctx.auth` instead of loading the same
user again.

For native identity claims already available on the JWT, prefer
`ctx.auth.getUserIdentity()`. In normal app code, prefer `auth.ctx()` /
`ctx.auth.userId` when you also want the current user document or
authorization state. Raw mixed-auth HTTP handlers should use
`auth.request.context(...)`.

The `ctx.auth` examples on this page assume you created auth-aware builders such
as `authQuery`, `authMutation`, or `authAction` with `auth.ctx()` in
`convex/functions.ts`.

`get`, `list`, and `viewer` are fully typed (`Doc<"User">`, Convex-native
`PaginationResult<Doc<"User">>`), and the `extend` field is typed when
configured. Pair them with `auth.v.*` as your function `returns:` — see
[Typed Returns](/reference/typed-returns).

## Methods

| Method   | Signature                                             | Returns                                                              | Description                                                                                                             |
| -------- | ----------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `get`    | `(ctx, { id })`                                       | `Doc<"User"> \| null`                                                | Reads a user document by ID.                                                                                            |
| `id`     | `(ctx)`                                               | `Id<"User"> \| null`                                                 | Current session user's id, or `null` when unauthenticated. Faster than `viewer` when you only need the id (no DB read). |
| `list`   | `(ctx, { where?, paginationOpts, orderBy?, order? })` | `PaginationResult<Doc<"User">>` — `{ page, isDone, continueCursor }` | Lists users with optional filtering and pagination. Convex-native shape; pass directly to `usePaginatedQuery`.          |
| `update` | `(ctx, { id, patch })`                                | `null`                                                               | Updates fields on a user document.                                                                                      |
| `viewer` | `(ctx)`                                               | `Doc<"User"> \| null`                                                | Returns the current session user's full document, or `null` when unauthenticated.                                       |
| `remove` | `(ctx, { id })`                                       | `null`                                                               | Deletes the user and all auth-owned sessions, accounts, memberships, factors, keys, and emails.                         |

> Active-group selection lives on the dedicated `auth.group.active`
> namespace (`get` / `update` / `reset`), not on `auth.user`.

### `auth.user.email`

Provider-agnostic management of every email a user owns (across OAuth, SSO,
and SCIM). The collection is exposed via `.list`; `User.email` remains the
single denormalized primary pointer.

| Method        | Signature                   | Returns                    | Description                                                                                                       |
| ------------- | --------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `list`        | `(ctx, { userId? })`        | `Doc<"UserEmail">[]`       | Every email the user owns, with provenance (`source`, `connectionId`, `verificationTime`, `isPrimary`).           |
| `create`      | `(ctx, { email, userId? })` | `{ email }`                | Records an **unverified** address. Does not verify (verification stays proof-driven) and does not become primary. |
| `remove`      | `(ctx, { email, userId? })` | `{ email }`                | Removes an address. Throws if it is the primary, the only verified email, or a connection-managed row.            |
| `promote`     | `(ctx, { email, userId? })` | `{ email }`                | Promotes a **verified** address to primary and synchronizes `User.email`.                                         |
| `primary.get` | `(ctx, { userId? }?)`       | `Doc<"UserEmail"> \| null` | Reads the current primary email.                                                                                  |

`userId` defaults to the current session user everywhere.

## Examples

### Current user ID in app code

```ts
// `auth.ctx()` already validated the session.
const userId = ctx.auth.userId;

// Or, outside an `auth.ctx()` wrapper, in any handler with `ctx.auth`:
const userId = await auth.user.id(ctx); // Id<"User"> | null
```

### Get the current user document

```ts
// `auth.ctx()` already injected the user document.
const user = ctx.auth.user;
```

### Get any user by ID

```ts
const user = await auth.user.get(ctx, { id: userId });
```

### Remove a user

```ts
await auth.user.remove(ctx, { id: userId });
```

Removal plans the complete auth-owned cascade before its first write. It
deletes the user's sessions, refresh tokens, accounts, verification and
recovery state, factors, device codes, SCIM identity, and OAuth grants in one
transaction. Shared OAuth clients and historical invite or webhook records are
preserved with their creator attribution cleared. The operation rejects more
than 100 dependent rows with `CASCADE_TOO_LARGE` instead of partially deleting
the identity; remove unusually large child collections in bounded operations
before retrying.

### Change active group

`ctx.auth.groupId`, `ctx.auth.role`, and `ctx.auth.grants` are the active
authorization snapshot for the current handler. Change the preference through
`auth.group.active` only in the explicit user action that selects a different
group; do not call it again merely to rediscover the current group:

```ts
await auth.group.active.update(ctx, { groupId: orgId, userId });

const active = await auth.group.active.get(ctx, { userId });
const activeGroupId = active?.groupId ?? null;

await auth.group.active.reset(ctx, { userId });
```

### Advanced: raw HTTP mixed auth

```ts
const authContext = await auth.request.context.optional(ctx, request);
if (authContext.userId === null) {
  return new Response("Unauthorized", { status: 401 });
}
```
