---
title: auth.account
description: Safe account management for the current user.
---

<svelte:head>

  <title>auth.account - convex-auth</title>
</svelte:head>

# auth.account

`auth.account` exposes linked sign-in capabilities without exposing credential
material. It is the application-facing boundary for answering questions such as
“does this user have a password account?” or letting the current user unlink an
account. Password hashes, PIN hashes, provider account identifiers, secrets, and
provider extension data never leave the component through this namespace.

Call `list(ctx)` to read the current user's linked accounts. Each
`AccountSummary` contains a branded `id`, a branded `userId`, `provider`,
`createdAt`, `emailVerified`, and `phoneVerified`. Pass a `provider` when the UI
only needs one capability.

```ts
const accounts = await auth.account.list(ctx, { provider: "password" });

const hasPassword = accounts.length > 0;
```

Directory queries can request a bounded batch of as many as 100 users in one
component call. Duplicate IDs are ignored, and the optional provider filter is
applied inside the component. This avoids an N+1 component query while keeping
the result deliberately redacted.

```ts
ctx.auth.assert("members.read");

const passwordAccounts = await auth.account.list(ctx, {
  userIds: members.map((member) => member.userId),
  provider: "password",
});

const passwordUsers = new Set(passwordAccounts.map((account) => account.userId));
```

An explicit `userIds` batch is an administrative read, so Convex Auth cannot
infer whether the viewer may inspect that application-defined directory. The
calling query must check its grant, membership, or ownership rule before
passing those IDs. Authentication alone is not directory authorization.

`remove(ctx, { id })` unlinks one of the current user's accounts and returns the
same branded account ID. It refuses to remove an account the user does not own
and preserves at least one sign-in method.

```ts
const [account] = await auth.account.list(ctx, { provider: "github" });
if (account) {
  await auth.account.remove(ctx, { id: account.id });
}
```

WebAuthn's backing account is intentionally absent from `list` and cannot be
removed here. Manage passkeys through [`auth.factor`](/api/factor), which keeps
the credential and its backing identity atomic. Account creation, credential
verification, credential updates, and linking belong to provider ceremonies;
application code should not create a parallel account or credential table.
