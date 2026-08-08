---
title: auth.factor
description: Safe passkey and TOTP management for the current user.
---

<svelte:head>

  <title>auth.factor - convex-auth</title>
</svelte:head>

# auth.factor

`auth.factor` manages the current user's WebAuthn and TOTP factors without
exposing credential material.

| Method   | Signature                              | Returns           | Description                                         |
| -------- | -------------------------------------- | ----------------- | --------------------------------------------------- |
| `list`   | `(ctx)`                                | `FactorSummary[]` | Lists sanitized WebAuthn and TOTP summaries.        |
| `update` | `(ctx, { kind, id, patch: { name } })` | `{ kind, id }`    | Renames an owned factor.                            |
| `remove` | `(ctx, { kind, id })`                  | `{ kind, id }`    | Removes an owned factor and records an audit event. |

```ts
const factors = await auth.factor.list(ctx);

await auth.factor.update(ctx, {
  kind: "webauthn",
  id: factorId,
  patch: { name: "Work security key" },
});

await auth.factor.remove(ctx, {
  kind: "totp",
  id: totpId,
});
```

WebAuthn summaries omit the credential ID, public key, signature counter, and
other assertion material. TOTP summaries omit the secret, digits, and period.
Ownership is always derived from the authenticated session.
