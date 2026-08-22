---
title: Typed Returns (auth.v)
description: Convex returns validators and extend-aware types for the auth read surface.
---

Convex requires a `returns:` validator on every public function, and the
client's `useQuery` type is inferred from that validator. To keep consumers
from hand-rolling DTO validators and casting query results, `defineAuth`
exposes ready-made validators on `auth.v`. When application code needs a named
document type, derive it from the configured validator with Convex's `Infer`.

The facade reads are fully typed end to end. `auth.user.get` returns a branded,
extend-aware user document or `null`; `auth.user.list` returns Convex's native
`PaginationResult` shape. The same relationship holds for groups, memberships,
and group invites, so a value can move from the facade through a public function
to `useQuery` or `usePaginatedQuery` without an assertion or a hand-written DTO.

`auth.v.user`, `auth.v.group`, `auth.v.member`, and `auth.v.invite` validate one
document. `auth.v.viewer` validates a user or `null`, while
`auth.v.list(item)` wraps any item validator in Convex's
`{ page, isDone, continueCursor }` pagination result. Their IDs remain branded
as `Id<"User">`, `Id<"Group">`, `Id<"GroupMember">`, and
`Id<"GroupInvite">` even though the documents cross a component boundary.

```ts
// convex/functions.ts
import { customQuery } from "convex-helpers/server/customFunctions";
import { query } from "./_generated/server";
import { auth } from "./auth";

export const authQuery = customQuery(query, auth.ctx());
```

```ts
// convex/users.ts
import { authQuery } from "./functions";
import { auth } from "./auth";

export const viewer = authQuery({
  returns: auth.v.user,
  handler: (ctx) => ctx.auth.user,
});

export const users = authQuery({
  returns: auth.v.list(auth.v.user),
  handler: (ctx) =>
    auth.user.list(ctx, {
      paginationOpts: { cursor: null, numItems: 25 },
    }),
});
```

## Composing richer reads

`auth.ctx()` validates the current session while reading the user, active
membership, active group, role, and grants in one component snapshot. Return
`ctx.auth.user` for a viewer query and use `ctx.auth.groupId`, `ctx.auth.role`, or
`ctx.auth.grants` for the active authorization state. Calling
`auth.user.viewer`, `auth.group.active.get`, or `auth.member.get` immediately
afterward repeats component work without making the decision more current.

Use an explicit facade read only when the requested data is outside that
snapshot, such as a paginated membership directory or a group selected by an
administrator. Compose the matching `auth.v` validators at that boundary:

```ts
import { v } from "convex/values";

export const group = authQuery({
  args: { id: auth.v.id("Group") },
  returns: v.union(auth.v.group, v.null()),
  handler: (ctx, args) => auth.group.get(ctx, { id: args.id }),
});
```

Application schemas sometimes need to store an auth component ID before the
configured `auth` value can be imported without creating a generated-API
cycle. Use the narrow standalone ID validator for that case:

```ts
import { defineSchema, defineTable } from "convex/server";
import { vAuthId } from "@estifanos-sh/convex-auth/server";

export default defineSchema({
  documents: defineTable({ ownerId: vAuthId("User") }),
});
```

`vAuthId` validates the cross-component wire value as a string while retaining
the selected component table brand. It does not expose the component schema or
manufacture document validators.

## Extend-aware types

When you pass `extend` validators to `defineAuth` (see
[Configuration](/reference/config)), `auth.v.*` carries that exact shape. This
applies to `GroupInvite` as well as users, groups, and memberships.

```ts
import { defineAuth } from "@estifanos-sh/convex-auth/server";
import type { Infer } from "convex/values";
import { v } from "convex/values";

export const auth = defineAuth(components.auth, {
  providers,
  extend: {
    GroupInvite: v.object({
      campaign: v.optional(v.string()),
    }),
  },
});

type Invite = Infer<typeof auth.v.invite>;

const invite = await auth.invite.get(ctx, { id: inviteId });
const campaign = invite?.extend?.campaign; // string | undefined
```

An omitted extension validator is intentionally inferred as `unknown`, never
`any`. Component storage remains flexible, but application code must narrow an
extension without a validator before using it. Configure the validator when the
field is part of your contract; the same validator then checks public returns at
runtime and supplies their TypeScript shape.

Do not export a second application-wide auth-context type. `auth.ctx()` and
`auth.context(ctx)` already preserve the configured extensions, branded IDs,
and resolved fields through local inference. Use `ctx.auth` at the protected
handler boundary, then pass domain-specific values to application helpers.

```ts
export const viewer = authQuery({
  returns: auth.v.user,
  handler: async (ctx) => {
    const user = ctx.auth.user;
    return user;
  },
});
```

The configured `auth.v` object is the public validator contract. Internal
storage validators and generic runtime-result types are intentionally not
exported from the server entry point: they describe library machinery rather
than an application's configured auth definition. This keeps the obvious path
fully typed without giving application code a reason to cast or duplicate the
component model.
