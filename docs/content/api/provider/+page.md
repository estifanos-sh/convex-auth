---
title: auth.provider
description: Compose trusted server-side authentication proofs without creating an intermediate session.
---

<svelte:head>

  <title>auth.provider - convex-auth</title>
</svelte:head>

# auth.provider

The `auth.provider` namespace is the advanced server-side composition surface
for moving a trusted proof through the same provider and session lifecycle as a
normal client sign-in. It is available on the value returned by `defineAuth`
and on the auth context passed to a custom provider callback.

Most application code does not need this namespace. Browser and native clients
should call `authClient.signIn(...)`. A credentials provider that verifies an
auth-owned password, PIN, or other secret should prefer
`ctx.auth.credentials.verify(...)` or `ctx.auth.credentials.provision(...)`;
those helpers keep account lookup, attempt limiting, linking, continuation, and
session issuance inside Convex Auth.

## Methods

| Method     | Signature                                  | Description                                                                |
| ---------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `signIn`   | `(ctx, { provider, accountId?, params? })` | Runs a configured provider from trusted server code.                       |
| `continue` | `(ctx, { userId, operation })`             | Continues a proven user into a typed provider operation without a session. |

Both methods require an action context. Pass the provider configuration object,
not a provider ID string. Return the result to the caller unchanged so the
client runtime can finish redirects, WebAuthn, email verification, or another
deferred ceremony when required.

## Trusted server sign-in

`auth.provider.signIn` is for a server flow that already owns the provider
configuration and needs the standard Convex Auth sign-in behavior. Immediate
providers can return a user and session ID; multi-step providers return their
deferred result for the client to finish.

```ts
const passwordProvider = password();

const result = await auth.provider.signIn(ctx, {
  provider: passwordProvider,
  params: { flow: "signIn", email, password: suppliedPassword },
});

return result;
```

Do not use this method to bypass a provider's proof. The caller is responsible
for protecting the action and for obtaining `params` through an appropriate
trusted boundary.

## Continue one proof into another

`auth.provider.continue` binds a user established by the first proof to a typed
operation from the next provider. No restricted, temporary, or final session is
issued between the two proofs.

```ts
const passkeys = webauthn();

const access = credentials({
  id: "staff-proof",
  params: v.object({ proof: v.string() }),
  authorize: async (params, ctx) => {
    const userId = await verifyAppOwnedProof(ctx, params.proof);
    if (userId === null) return null;

    return await ctx.auth.provider.continue(ctx, {
      userId,
      operation: passkeys.signIn(),
    });
  },
  extraProviders: [passkeys],
});

defineAuth(components.auth, { providers: [access] });
```

The first proof must establish the returned `userId`; never accept that ID from
client input. If the first proof is an auth-owned credential, use
`ctx.auth.credentials.verify` instead. If it is provisioning a new credential,
use `ctx.auth.credentials.provision` so account creation or linking and the
second ceremony complete atomically.

Do not call generated `components.auth.*` functions to assemble a custom
credential flow. The generated component contract is internal wiring, while
`auth.provider` and `ctx.auth.credentials` are the stable application boundary.
