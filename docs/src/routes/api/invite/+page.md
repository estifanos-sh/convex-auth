---
title: auth.invite
description: Invite management — create, accept, and revoke group invitations.
---

<svelte:head>

  <title>auth.invite - convex-auth</title>
</svelte:head>

# auth.invite

The `auth.invite` namespace manages invitations to groups. Invites have a status
lifecycle: `pending` -> `accepted` or `revoked`.

Token acceptance is a separate current-user flow: `token.accept` derives the
accepting user from the authenticated context rather than trusting an input ID.

## Methods

| Method         | Signature                                                                | Returns                                                                     | Description                                                                                                          |
| -------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `create`       | `(ctx, { data: { groupId?, email?, roleIds?, expiresTime?, extend? } })` | `{ id, token }`                                                             | Creates a pending invite. Throws `ConvexError` with code `INVALID_ROLE_IDS` on failure.                              |
| `get`          | `(ctx, { id })`                                                          | `Doc<"GroupInvite">`                                                        | Reads an invite document by ID.                                                                                      |
| `list`         | `(ctx, { where?, paginationOpts, orderBy?, order? })`                    | `PaginationResult<Doc<"GroupInvite">>` — `{ page, isDone, continueCursor }` | Lists invites, optionally filtered by group and/or status. Convex-native shape; pass through to `usePaginatedQuery`. |
| `accept`       | `(ctx, { id, acceptedByUserId? })`                                       | `{ id, acceptedByUserId }`                                                  | Accepts a pending invite and records acceptance metadata.                                                            |
| `revoke`       | `(ctx, { id })`                                                          | `null`                                                                      | Revokes a pending invite so it can no longer be accepted.                                                            |
| `token.get`    | `(ctx, { token })`                                                       | `Doc<"GroupInvite"> \| null`                                                | Resolves an invite token.                                                                                            |
| `token.accept` | `(ctx, { token })`                                                       | Acceptance result                                                           | Accepts for the current authenticated user and creates the membership when applicable.                               |

## Examples

### Create and accept an invite

```ts
// Admin creates an invite
const { id, token } = await auth.invite.create(ctx, {
  data: {
    groupId: orgId,
    email: "alice@example.com",
    roleIds: ["member"],
  },
});

// Later, when Alice signs in and accepts:
await auth.invite.token.accept(ctx, { token });
```

### Create an invite with expiration

```ts
const { id } = await auth.invite.create(ctx, {
  data: {
    groupId: orgId,
    email: "bob@example.com",
    roleIds: ["viewer"],
    expiresTime: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
  },
});
```

### List pending invites for a group

```ts
const pending = await auth.invite.list(ctx, {
  where: { groupId: orgId, status: "pending" },
  paginationOpts: { numItems: 25, cursor: null },
});
```

### Revoke an invite

```ts
await auth.invite.revoke(ctx, { id });
```
