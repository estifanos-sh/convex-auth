---
title: auth.group
description: Model organizations, workspaces, and teams in Convex Auth.
---

The `auth.group` namespace provides methods for managing groups (organizations,
teams, workspaces, etc.). Groups can be nested to form a hierarchy.

## Methods

| Method      | Signature                                                          | Returns                                                               | Description                                                        |
| ----------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `create`    | `(ctx, { data: { name, slug?, type?, parentGroupId?, extend? } })` | `Id<"Group">`                                                         | Creates a new group. Optionally nest under a parent group.         |
| `get`       | `(ctx, { id })`                                                    | `Doc<"Group">`                                                        | Reads a group document by ID.                                      |
| `list`      | `(ctx, { where?, paginationOpts, orderBy?, order? })`              | `PaginationResult<Doc<"Group">>` — `{ page, isDone, continueCursor }` | Lists groups, optionally filtered by parent. Convex-native shape.  |
| `ancestors` | `(ctx, { groupId, maxDepth?, includeSelf? })`                      | `{ ancestors, cycleDetected, maxDepthReached }`                       | Walks from a group toward the root.                                |
| `update`    | `(ctx, { id, patch })`                                             | `null`                                                                | Updates a group's name, slug, type, parent, or extend metadata.    |
| `remove`    | `(ctx, { id })`                                                    | `null`                                                                | Deletes a group and all its nested children, members, and invites. |

### `auth.group.active`

| Method   | Signature                     | Returns                                               | Description                                                               |
| -------- | ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `get`    | `(ctx, { userId? }?)`         | Active group, membership, roles, and grants or `null` | Reads the stored preference, falling back to the user's first membership. |
| `update` | `(ctx, { groupId, userId? })` | `{ groupId }`                                         | Validates membership and stores the selection transactionally.            |
| `reset`  | `(ctx, { userId? }?)`         | `null`                                                | Clears the preference so deterministic fallback applies.                  |

`userId` defaults to the authenticated user. `reset` does not create a “no
active group” state; it removes only the preference.

## Examples

### Create a group with tags

Tags are useful for categorizing groups (e.g. plan tier, region):

```ts
const groupId = await auth.group.create(ctx, {
  data: {
    name: "Acme Corp",
    type: "workspace",
    extend: { plan: "pro" },
  },
});
```

### Create a nested group

```ts
const teamId = await auth.group.create(ctx, {
  data: {
    name: "Engineering",
    parentGroupId: orgId,
    type: "team",
  },
});
```

### Walk the hierarchy

```ts
const { ancestors } = await auth.group.ancestors(ctx, {
  groupId: teamId,
  includeSelf: false,
});
// ancestors => [{ _id: orgId, name: "Acme Corp", ... }]
```

### Update group extension data

```ts
await auth.group.update(ctx, {
  id: groupId,
  patch: {
    slug: "acme",
    extend: { plan: "enterprise" },
  },
});
```

## Denormalized fields

Groups include two denormalized fields maintained automatically:

| Field         | Type          | Description                                                                 |
| ------------- | ------------- | --------------------------------------------------------------------------- |
| `rootGroupId` | `Id<"Group">` | The root ancestor of this group. Self-referencing for root groups.          |
| `isRoot`      | `boolean`     | `true` when the group has no parent. Used for efficient root group queries. |

These fields are computed at creation time and cascaded on hierarchy changes.
You can use them for efficient queries like listing all root groups:

```ts
const workspaces = await auth.group.list(ctx, {
  where: { isRoot: true },
  paginationOpts: { numItems: 25, cursor: null },
});
```
