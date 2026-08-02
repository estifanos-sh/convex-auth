# Client wiring

Read the installed entrypoint types before adapting these examples. Create one
browser auth client and let the framework binding own only its presentation and
context.

## React

```tsx
import { client as createAuthClient } from "@robelest/convex-auth/browser";
import { ConvexAuthProvider } from "@robelest/convex-auth/react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { api } from "../convex/_generated/api";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
const auth = createAuthClient({ convex, api: api.auth });

export function Root() {
  return (
    <ConvexProvider client={convex}>
      <ConvexAuthProvider auth={auth}>
        <App />
      </ConvexAuthProvider>
    </ConvexProvider>
  );
}
```

Use `SignedIn`, `SignedOut`, `AuthLoading`, and `useAuthActions` for normal UI.
Use `useConvexAuthClient` only for factor-specific flows such as passkey or TOTP
enrollment. Do not create a new client during render.

## Svelte 5

```svelte
<script lang="ts">
  import { page } from "$app/state";
  import { client as createAuthClient } from "@robelest/convex-auth/browser";
  import { setupConvexAuth } from "@robelest/convex-auth/svelte";
  import { setupConvex } from "convex-svelte";
  import { onDestroy } from "svelte";
  import { api } from "$convex/_generated/api.js";

  let { children } = $props();
  const convex = setupConvex(import.meta.env.VITE_CONVEX_URL);
  const authClient = createAuthClient({ convex, api: api.auth, location: () => page.url });
  const auth = setupConvexAuth(authClient);
  onDestroy(() => authClient.destroy());
</script>

{#if auth.signedIn}
  {@render children()}
{:else}
  <Login />
{/if}
```

Do not also call `setupAuth` from `convex-svelte`; the Robelest browser client
owns the Convex `setAuth` lifecycle. Use `useConvexAuth()` in descendants.

## Expo and native apps

Use `@robelest/convex-auth/expo` and the installed native peer dependencies.
Keep refresh credentials in secure platform storage, use claimed HTTPS origins
for OAuth and passkeys, and validate both iOS associated domains and Android
asset links on physical devices.

## SSR

Read the framework-specific current Markdown page before implementation. Seed
the browser auth client with the server-known token, preserve cookie attributes,
and avoid a second client-side refresh loop. Verify direct navigation, refresh,
sign-in callback, and sign-out—not only client-side routing.
