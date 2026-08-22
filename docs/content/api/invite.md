---
title: auth.invite
description: Invite management — create, accept, and revoke group invitations.
---

The `auth.invite` namespace owns the full group-invitation lifecycle. A newly
created invite is `pending`; accepting it records the recipient and can create
the membership, while revoking it prevents later acceptance. Invite IDs,
accepted-user IDs, group IDs, and membership IDs retain their Convex table
brands throughout the facade, so callers do not need to turn strings into IDs
with assertions.

Create returns a one-time raw token for the delivery link. Convex Auth stores
its hash, not a second application-owned invite record. The recipient should use
`token.accept`, which derives the accepting user from the authenticated context
instead of trusting a browser-supplied user ID.

```ts
const { id, token } = await auth.invite.create(ctx, {
  data: {
    groupId: orgId,
    email: "alice@example.com",
    roleIds: ["member"],
  },
});

await auth.invite.token.accept(ctx, { token });
```

Use `get(ctx, { id })` for one invite and `list` for a filtered, paginated
administrative view. `list` returns Convex's native pagination object, so the
result can pass directly through a public query using
`auth.v.list(auth.v.invite)`.

```ts
const pending = await auth.invite.list(ctx, {
  where: { groupId: orgId, status: "pending" },
  paginationOpts: { numItems: 25, cursor: null },
});
```

`accept(ctx, { id, acceptedByUserId? })` is the lower-level administrative
transition and does not create a membership. `revoke(ctx, { id })` invalidates a
pending invite. Prefer token acceptance for the normal recipient flow.

```ts
await auth.invite.revoke(ctx, { id });
```

## Typed invite extensions

Invite metadata that genuinely belongs to authentication can be declared once
on `GroupInvite`. The configured shape is carried by `create` inputs, facade
reads, and `auth.v.invite` return validation.

```ts
export const auth = defineAuth(components.auth, {
  providers,
  extend: {
    GroupInvite: v.object({
      campaign: v.optional(v.string()),
    }),
  },
});

const { id } = await auth.invite.create(ctx, {
  data: {
    groupId,
    email: "alice@example.com",
    extend: { campaign: "fall-launch" },
  },
});

const invite = await auth.invite.get(ctx, { id });
const campaign = invite?.extend?.campaign; // string | undefined
```

When `GroupInvite` is not configured, `extend` is `unknown` rather than `any`.
Narrow it before use or add a validator to make it part of the application
contract. Product workflow state that does not affect invitation or membership
semantics belongs in an application table keyed by the branded invite or user
ID, not in a parallel invitation system.
