---
title: auth.account
description: Safe account management for the current user.
---

<svelte:head>

  <title>auth.account - convex-auth</title>
</svelte:head>

# auth.account

`auth.account` is the current user's account-management surface. It never
returns password hashes or other credential secrets.

| Method   | Signature       | Returns            | Description                                                            |
| -------- | --------------- | ------------------ | ---------------------------------------------------------------------- |
| `list`   | `(ctx)`         | `AccountSummary[]` | Lists the current user's linked provider accounts.                     |
| `remove` | `(ctx, { id })` | `{ id }`           | Removes an owned account while preserving at least one sign-in method. |

```ts
const accounts = await auth.account.list(ctx);

await auth.account.remove(ctx, {
  id: accounts[0].id,
});
```

Each summary contains `id`, `provider`, `createdAt`, `emailVerified`, and
`phoneVerified`. It does not expose the provider account identifier, credential
secret, or provider extension data. WebAuthn's internal backing account is not
listed or removable here; use [`auth.factor`](/api/factor) so the credential and
its backing identity are removed atomically.

Account creation, credential lookup, credential updates, and linking are owned
by provider ceremonies. Custom credentials providers can return a verified
identity for the runtime to provision:

```ts
credentials({
  id: "invite",
  authorize: async (params) => {
    const invite = await verifyInvite(params.token);
    if (!invite) return null;

    return {
      provision: {
        account: { id: invite.email },
        profile: { email: invite.email, name: invite.name },
      },
    };
  },
});
```

Use [`auth.factor`](/api/factor) to manage passkeys and TOTP enrollments.
