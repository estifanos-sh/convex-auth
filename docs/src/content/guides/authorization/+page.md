---
title: Authorization
description: Protect user-owned and group-owned application data.
---

<svelte:head>

  <title>Authorization</title>
</svelte:head>

# Authorization

Convex Auth establishes the caller's identity. Your application still decides
whether that user may perform a particular operation. Keep those decisions close
to the data they protect and base them on the trusted identity in `ctx.auth`, not
on an email, a provider account ID, or a user ID supplied by the browser.

## User-owned data

Store the Convex Auth `userId` on documents that belong to a person. An
authenticated builder resolves the caller before the handler runs, so creation
can assign ownership without exposing an `ownerId` argument.

```ts
export const create = authMutation({
  args: { title: v.string() },
  handler: (ctx, args) =>
    ctx.db.insert("projects", {
      title: args.title,
      ownerId: ctx.auth.userId,
    }),
});
```

Reads and updates must enforce the same boundary. A document ID is not proof of
access.

```ts
export const rename = authMutation({
  args: { id: v.id("projects"), title: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.id);
    if (!project || project.ownerId !== ctx.auth.userId) {
      throw new Error("Project not found");
    }
    await ctx.db.patch(args.id, { title: args.title });
  },
});
```

Returning the same result for a missing document and a document owned by someone
else avoids revealing that another user's record exists.

## Group access

When access belongs to a user's relationship with a group, model it with Convex
Auth memberships. `definePermissions` gives the application one typed vocabulary
for grants. Roles collect grants for administration, but handlers authorize the
grant itself so a role can evolve without changing product code.

```ts
// convex/permissions.ts
import { definePermissions } from "@estifanos-sh/convex-auth/permissions";

export const permissions = definePermissions({
  grants: ["projects.read", "projects.create", "members.manage"],
  roles: {
    admin: {
      label: "Administrator",
      grants: ["projects.read", "projects.create", "members.manage"],
    },
    member: {
      label: "Member",
      grants: ["projects.read"],
    },
  },
});
```

Pass the same `permissions` value to `defineAuth`. Before a protected group
operation, assert the exact grant against the context snapshot that already
resolved the active membership. This avoids a second user, active-group, or
membership lookup in every handler.

```ts
ctx.auth.assert("projects.create", project);
```

Use `auth.member.get` for an explicit direct-membership read outside the active
context, such as an administration screen. Use `auth.member.resolve` only when
the application deliberately supports inherited membership through nested
groups. The explicit name makes a potentially broader authorization lookup
visible at the call site.

## Profiles are not identities

Email, name, and image are useful presentation data, but they are not durable
authorization keys. Email addresses can change, and different providers expose
different profile claims. Read `ctx.auth.user` when a handler needs the current
auth profile and use `ctx.auth.userId` for ownership and access checks.

An app-owned profile table is appropriate when the product needs biography,
preferences, onboarding state, or other domain fields. Key it by `userId` and do
not copy credentials, accounts, sessions, or recovery state into it. A profile
extends the product; it does not replace the auth user.

## Public and optional handlers

Use required authenticated builders for protected work. Optional auth is useful
for a genuinely public page that adds viewer-specific state, such as whether the
current user has bookmarked an article. It should not be used merely to avoid
handling an authentication error.

Authentication and authorization failures should also remain distinct. A
missing session means the caller must sign in. A signed-in user without the
required ownership or grant is authenticated but forbidden. Keeping that
distinction in the handler makes both the API and the user experience easier to
reason about.
