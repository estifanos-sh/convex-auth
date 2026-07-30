---
title: Svelte
description: Reactive auth state and gate components for Svelte 5 apps.
---

<svelte:head>

  <title>Svelte - convex-auth</title>
</svelte:head>

# Svelte

`@robelest/convex-auth/svelte` bridges an app-owned browser auth client into a
Svelte 5 runes object, shared through context, plus gate components. It is
designed to compose with the official
[`convex-svelte`](https://github.com/get-convex/convex-svelte) client in
SvelteKit and Vite Svelte apps running Svelte 5.

`svelte` is an optional peer dependency — if your app uses this subpath, you
already have Svelte installed. Apps that only consume the server entrypoints
don't pay for Svelte.

## Setup

Call `setupConvexAuth` once in your root layout, passing a browser auth client
created with the Convex client returned by `setupConvex`. The Svelte binding
subscribes to the auth client and shares reactive auth through context; the app
still owns the auth client's lifetime.

```svelte
<!-- +layout.svelte -->
<script lang="ts">
  import { page } from "$app/state";
  import { setupConvex } from "convex-svelte";
  import { onDestroy } from "svelte";
  import { client as createAuthClient } from "@robelest/convex-auth/browser";
  import { setupConvexAuth } from "@robelest/convex-auth/svelte";
  import { api } from "$convex/_generated/api.js";

  let { children } = $props();

  const convex = setupConvex(import.meta.env.VITE_CONVEX_URL);
  const authClient = createAuthClient({
    convex,
    api: api.auth,
    location: () => page.url,
  });
  const auth = setupConvexAuth(authClient);
  onDestroy(() => authClient.destroy());
</script>

{#if auth.signedIn}
  {@render children()}
{:else}
  <Login />
{/if}
```

Use `useQuery`, `useMutation`, and `useAction` from `convex-svelte` as usual.
Do not also call `setupAuth`: the convex-auth browser client already owns the
Convex `setAuth` lifecycle, including forced token refresh. Read auth state
through `useConvexAuth()` so there is one auth lifecycle and one source of
truth.

`auth` is reactive: read `auth.signedIn`, `auth.signedOut`, `auth.loading`,
`auth.status`, and `auth.token` directly in markup — no `$state` or `subscribe`
of your own. Because the browser client boots synchronously from persisted
storage, a returning user can be `signedIn` on the first paint. Fresh sign-in
and refresh tokens report `loading` until Convex confirms them.

## `useConvexAuth()`

Read the same reactive auth from any descendant component. No prop drilling.

```svelte
<script lang="ts">
  import { useConvexAuth } from "@robelest/convex-auth/svelte";

  const auth = useConvexAuth();
</script>

<button onclick={() => auth.signOut()}>Sign out</button>
```

`auth.signIn` and `auth.signOut` are the client's actions; `auth.token` is the
JWT when signed in and `null` otherwise.

## Gate components

Prefer `{#if auth.signedIn}` when you already have `auth`. The gates are for
declarative wrapping and mirror the React binding. `<SignedIn>` passes the JWT
(typed `string`) to its `children` snippet. `<AuthLoading>` is optional — a
synchronous-storage SPA effectively never hits it.

```svelte
<script lang="ts">
  import { SignedIn, SignedOut, AuthLoading, useConvexAuth } from "@robelest/convex-auth/svelte";

  const auth = useConvexAuth();
</script>

<AuthLoading>
  <span>Loading…</span>
</AuthLoading>
<SignedOut>
  <button onclick={() => auth.signIn("google")}>Sign in with Google</button>
</SignedOut>
<SignedIn>
  {#snippet children(token)}
    <Dashboard {token} />
  {/snippet}
</SignedIn>
```

## `auth.client`

The underlying imperative client, for factor flows (`totp`, `webauthn`, `device`)
and low-level methods (`completeOAuth`, `param`, `initialize`).

```svelte
<script lang="ts">
  import { useConvexAuth } from "@robelest/convex-auth/svelte";

  const auth = useConvexAuth();
</script>

<button onclick={() => auth.client.totp?.setup()}>Enable TOTP</button>
```

`client.totp`, `client.webauthn`, `client.device` are present only when the
underlying providers are configured server-side.

## SSR

Create the browser auth client with the server-known JWT via the `token` option,
then pass that client to `setupConvexAuth`. See [SSR overview](/ssr/overview)
and [SvelteKit](/ssr/sveltekit).
