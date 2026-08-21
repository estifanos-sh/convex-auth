---
title: auth.session
description: Session management — read, list, and revoke sessions.
---

<svelte:head>

  <title>auth.session - convex-auth</title>
</svelte:head>

# auth.session

The `auth.session` namespace manages signed-in browser and device sessions.
Revocation advances a user-owned session epoch before any physical cleanup. A
revoked access token therefore fails the next auth-context resolution and its
refresh token cannot mint another token, even when an expired row has not been
removed yet.

The `ctx.auth` examples on this page assume the handler is using `auth.ctx()`-
backed builders such as `authQuery`, `authMutation`, or `authAction`.

Existing deployments are compatible with the epoch change: a legacy user or
session without an epoch is interpreted as epoch `0`. The next session
revocation writes the user's current epoch. No application-table migration is
required.

## Methods

| Method   | Signature                    | Returns                  | Description                                                                                     |
| -------- | ---------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| `id`     | `(ctx)`                      | `Id<"Session"> \| null`  | Current session id, or `null` when unauthenticated. Pairs with `auth.user.id(ctx)`.             |
| `revoke` | `(ctx, { userId, except? })` | `{ userId, except }`     | Revokes all sessions for a user. Pass `except` as an array of session IDs to keep those active. |
| `get`    | `(ctx, { id })`              | `Doc<"Session"> \| null` | Reads a session document by ID.                                                                 |
| `list`   | `(ctx, { userId })`          | `Doc<"Session">[]`       | Lists at most 16 non-expired sessions in the current epoch; it is not an audit-history export.  |

## Examples

### Read the current session ID

```ts
// Preferred — resolves the session id without parsing identity claims.
const sessionId = await auth.session.id(ctx); // Id<"Session"> | null
```

### Revoke all other sessions

This is useful for a "sign out everywhere else" feature. The retained session
is moved to the new epoch in the same mutation, so it remains valid while every
other session is revoked. The component may clean up old rows later; cleanup is
never the security boundary.

```ts
const sessionId = await auth.session.id(ctx);
if (!sessionId) {
  throw new Error("Current session missing");
}

await auth.session.revoke(ctx, {
  userId: ctx.auth.userId,
  except: [sessionId],
});
```

### List sessions for a user

```ts
const sessions = await auth.session.list(ctx, { userId: ctx.auth.userId });
```
