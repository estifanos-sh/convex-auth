---
title: Svelte
description: Reactive auth state for Svelte 5 apps.
---

<svelte:head>

  <title>Svelte - convex-auth</title>
</svelte:head>

# Svelte

`@estifanos-sh/convex-auth/svelte` bridges an app-owned browser auth client into
a Svelte 5 runes object, shared through context. It is designed to compose with
the official
[`convex-svelte`](https://github.com/get-convex/convex-svelte) client in
SvelteKit and Vite Svelte apps running Svelte 5.

`svelte` is an optional peer dependency — if your app uses this subpath, you
already have Svelte installed. Apps that only consume the server entrypoints
don't pay for Svelte.

## Setup

Keep the browser client in an app module, then call `useConvexAuth(authClient)`
in the root layout and every descendant that needs reactive auth. The app still
owns the client's lifetime.

```svelte
{/* +layout.svelte */}
<script lang="ts">
  import { onDestroy } from "svelte";
  import { useConvexAuth } from "@estifanos-sh/convex-auth/svelte";
  import { authClient } from "$lib/auth";

  let { children } = $props();

  const auth = useConvexAuth(authClient);
  onDestroy(() => authClient.destroy());
</script>

{#if auth.signedIn}
  {@render children()}
{:else}
  <Login />
{/if}
```

`api.auth` is generated from the actions exported by `convex/auth.ts`. Passing
it directly lets `authClient` retain each configured provider's sign-in
parameters and enabled factor helpers; no manual client type is needed. Use the
app-owned `authClient` for a provider-specific flow that depends on those exact
types.

Use `useQuery`, `useMutation`, and `useAction` from `convex-svelte` as usual.
Do not also call `setupAuth`: the convex-auth browser client already owns the
Convex `setAuth` lifecycle, including forced token refresh.

`auth` is reactive: read `auth.signedIn`, `auth.signedOut`, `auth.loading`,
`auth.status`, and `auth.token` directly in markup — no `$state` or `subscribe`
of your own. Because the browser client boots synchronously from persisted
storage, a returning user can be `signedIn` on the first paint. Fresh sign-in
and refresh tokens report `loading` until Convex confirms them.

## Descendant state

Import and pass the same app-owned `authClient` in any descendant component.
The client identity is checked so one component tree has one subscription.

```svelte
<script lang="ts">
  import { authClient } from "$lib/auth";
  import { useConvexAuth } from "@estifanos-sh/convex-auth/svelte";

  const auth = useConvexAuth(authClient);
</script>

<button onclick={() => auth.signOut()}>Sign out</button>
```

`auth.signIn` and `auth.signOut` are the client's actions; `auth.token` is the
JWT when signed in and `null` otherwise.

## Reactive UI

Use ordinary Svelte conditionals with the reactive bound state. A
synchronous-storage SPA effectively never reaches `loading` for a returning
session.

```svelte
<script lang="ts">
  import { authClient } from "$lib/auth";
  import { useConvexAuth } from "@estifanos-sh/convex-auth/svelte";

  const auth = useConvexAuth(authClient);
</script>

{#if auth.loading}
  <span>Loading…</span>
{:else if auth.signedOut}
  <button onclick={() => auth.signIn("google")}>Sign in with Google</button>
{:else}
  <Dashboard token={auth.token} />
{/if}
```

## `auth.client`

The underlying imperative client, for factor flows (`totp`, `webauthn`, `device`)
and low-level methods (`completeOAuth`, `param`, `initialize`).

```svelte
<script lang="ts">
  import { authClient } from "$lib/auth";
  import { useConvexAuth } from "@estifanos-sh/convex-auth/svelte";

  const auth = useConvexAuth(authClient);
</script>

<button onclick={() => authClient.totp.setup()}>Enable TOTP</button>
```

This TOTP example requires a TOTP provider. Call factors directly on the
app-owned `authClient`, where availability remains inferred from `api.auth`.

## SSR

Create the browser auth client with the server-known JWT via the `token` option,
then pass it to `useConvexAuth(authClient)`. See [SSR overview](/ssr/overview)
and [SvelteKit](/ssr/sveltekit).
