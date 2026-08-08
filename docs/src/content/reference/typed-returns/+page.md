---
title: Typed Returns (auth.v)
description: Convex returns validators and extend-aware types for the auth read surface.
---

<svelte:head>

  <title>Typed Returns - convex-auth</title>
</svelte:head>

# Typed Returns (`auth.v`)

Convex requires a `returns:` validator on every public function, and the
client's `useQuery` type is inferred from that validator. To keep consumers
from hand-rolling DTO validators and casting query results, `defineAuth`
exposes ready-made validators on `auth.v`, and the package exports the
matching document types.

The facade reads are fully typed end to end: `auth.user.list` returns a
Convex-native `PaginationResult<Doc<"User">>` (`{ page, isDone, continueCursor }`)
and `auth.user.get` / `auth.user.viewer` return `Doc<"User"> | null` — no
casts required. The pagination shape matches what `usePaginatedQuery` from
`convex/react` expects, so list queries can be passed directly to the hook.

## `auth.v.*`

| Validator           | Shape                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------- |
| `auth.v.user`       | Single `User` document (extend-aware)                                                   |
| `auth.v.group`      | Single `Group` document (extend-aware)                                                  |
| `auth.v.member`     | Single `GroupMember` (extend-aware)                                                     |
| `auth.v.invite`     | Single `GroupInvite` document                                                           |
| `auth.v.viewer`     | `User \| null` — current-user query                                                     |
| `auth.v.list(item)` | `PaginationResult<item>` — `{ page, isDone, continueCursor }` (matches `convex/server`) |

```ts
// convex/functions.ts
import { customQuery } from "convex-helpers/server/customFunctions";
import { query } from "./_generated/server";
import { auth } from "./auth";

export const authQuery = customQuery(query, auth.ctx());
```

```ts
// convex/users.ts
import { v } from "convex/values";
import { authQuery } from "./functions";
import { auth } from "./auth";

export const viewer = authQuery({
  returns: auth.v.viewer,
  handler: (ctx) => ctx.auth.user.viewer(ctx),
});

export const users = authQuery({
  returns: auth.v.list(auth.v.user),
  handler: (ctx) => ctx.auth.user.list(ctx),
});
```

## Composing richer reads

There is no bespoke "viewer with groups" helper — compose the existing
`auth.user.viewer`, `auth.member.list`, and `auth.group.get` facade methods
and build the `returns:` validator from the building blocks.

```ts
export const groups = authQuery({
  returns: v.union(
    v.object({
      ...auth.v.user.fields,
      memberships: v.array(auth.v.member),
      groups: v.array(auth.v.group),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const me = await ctx.auth.user.viewer(ctx);
    if (me === null) return null;
    const { page: memberships } = await ctx.auth.member.list(ctx, {
      where: { userId: me._id },
    });
    const groups = await ctx.auth.group.get(
      ctx,
      memberships.map((m) => m.groupId),
    );
    return { ...me, memberships, groups };
  },
});
```

## Extend-aware types

When you pass `extend` validators to `defineAuth` (see
[Configuration](/reference/config)), `auth.v.*` and the exported types
carry that shape — `viewer.extend.<field>` is typed instead of `any`.

```ts
import type { Viewer, Group, Membership, Doc } from "@estifanos-sh/convex-auth/server";
```

| Export       | Description                                |
| ------------ | ------------------------------------------ |
| `Doc<T>`     | A document from any auth table             |
| `Viewer`     | `User` document type (extend-aware)        |
| `Group`      | `Group` document type (extend-aware)       |
| `Membership` | `GroupMember` document type (extend-aware) |

The raw validators (`vUserDoc`, `vGroupDoc`, `vGroupMemberDoc`,
`vGroupInviteDoc`, `vPaginated`) and `createAuthValidators` are also exported
from `@estifanos-sh/convex-auth/server` for advanced composition.
