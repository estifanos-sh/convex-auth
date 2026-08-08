---
title: auth.member
description: Direct membership management and explicit inherited resolution.
---

<svelte:head>

  <title>auth.member - convex-auth</title>
</svelte:head>

# auth.member

Membership APIs make query cost explicit: `get` and `assert` inspect only a
direct membership, while `resolve` walks the group hierarchy.

| Method    | Signature                                       | Returns                                   | Description                                                                  |
| --------- | ----------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| `create`  | `(ctx, { data })`                               | `Id<"GroupMember">`                       | Creates a direct membership.                                                 |
| `get`     | `(ctx, { userId, groupId })`                    | `{ membership, roleIds, grants }`         | Indexed direct lookup. Also accepts `groupIds` for a batch lookup.           |
| `resolve` | `(ctx, { userId, groupId, maxDepth? })`         | Membership access plus traversal metadata | Explicitly resolves inherited access through parent groups.                  |
| `list`    | `(ctx, options?)`                               | `PaginationResult<Doc<"GroupMember">>`    | Lists raw membership documents; it does not join groups or calculate grants. |
| `update`  | `(ctx, { id, patch })`                          | `null`                                    | Updates roles or metadata.                                                   |
| `remove`  | `(ctx, { id })`                                 | `null`                                    | Deletes a membership.                                                        |
| `assert`  | `(ctx, { userId, groupId, roleIds?, grants? })` | `{ membership, roleIds, grants }`         | Enforces direct membership and requirements.                                 |

## Direct authorization

```ts
const access = await auth.member.get(ctx, { userId, groupId });

await auth.member.assert(ctx, {
  userId,
  groupId,
  grants: ["members.update"],
});
```

## Inherited authorization

```ts
const access = await auth.member.resolve(ctx, {
  userId,
  groupId: teamId,
  maxDepth: 16,
});

if (access.membership) {
  console.log(access.matchedGroupId, access.depth);
  console.log(access.traversedGroupIds);
}
```

This separation prevents a boolean option from silently changing an indexed
lookup into an unbounded hierarchy traversal.
