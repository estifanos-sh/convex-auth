# Client wiring

Read the installed entrypoint types before adapting these examples. Create one
browser auth client and let the framework binding own only its presentation and
context.

## React

```tsx
import { client as createAuthClient } from "@estifanos-sh/convex-auth/browser";
import { AuthLoading, SignedIn, SignedOut, useAuth } from "@estifanos-sh/convex-auth/react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { api } from "../convex/_generated/api";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
const authClient = createAuthClient({ convex, api: api.auth });

export function Root() {
  return (
    <ConvexProvider client={convex}>
      <App authClient={authClient} />
    </ConvexProvider>
  );
}
```

Always pass the generated `api.auth` reference directly. It carries configured
provider IDs, custom credential validator shapes, action results, and factor
capabilities. Do not add `InferClientApi`, a handwritten client interface, or a
cast around `authClient.signIn`.

Pass `authClient` to `SignedIn`, `SignedOut`, `AuthLoading`, and `useAuth`.
Call `signIn`, `signOut`, and configured factor helpers directly on that
app-owned client. Do not create a new client during render.

## Svelte 5

```svelte
<script lang="ts">
  import { page } from "$app/state";
  import { client as createAuthClient } from "@estifanos-sh/convex-auth/browser";
  import { useConvexAuth } from "@estifanos-sh/convex-auth/svelte";
  import { setupConvex } from "convex-svelte";
  import { onDestroy } from "svelte";
  import { api } from "$convex/_generated/api.js";

  let { children } = $props();
  const convex = setupConvex(import.meta.env.VITE_CONVEX_URL);
  const authClient = createAuthClient({ convex, api: api.auth, location: () => page.url });
  const auth = useConvexAuth(authClient);
  onDestroy(() => authClient.destroy());
</script>

{#if auth.signedIn}
  {@render children()}
{:else}
  <Login />
{/if}
```

Do not also call `setupAuth` from `convex-svelte`; the estifanos.sh browser client
owns the Convex `setAuth` lifecycle. Pass the same `authClient` to
`useConvexAuth(authClient)` in descendants. Prefer reactive `{#if}`
conditionals to global gate components.

## Expo and native apps

Use `@estifanos-sh/convex-auth/expo` and the installed native peer dependencies.
Keep refresh credentials in secure platform storage, use claimed HTTPS origins
for OAuth and passkeys, and validate both iOS associated domains and Android
asset links on physical devices.

## SSR

Read the framework-specific current Markdown page before implementation. Seed
the browser auth client with the server-known token, preserve cookie attributes,
and avoid a second client-side refresh loop. Verify direct navigation, refresh,
sign-in callback, and sign-out—not only client-side routing.
