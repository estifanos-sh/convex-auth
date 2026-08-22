---
title: SvelteKit
description: Integrate convex-auth SSR with SvelteKit using hooks and API routes.
---

SvelteKit integration uses two files: a server hook for token refresh on every
request, and an API route to proxy client-side sign-in/sign-out calls.

## Server hook

In `src/hooks.server.ts`, call `auth.refresh()` on every request. Apply the
returned cookies and pass the token to page data via `event.locals`.

```ts
// src/hooks.server.ts
import { server } from "@estifanos-sh/convex-auth/server";
import type { Handle } from "@sveltejs/kit";
import { withServerConvexToken } from "convex-svelte/sveltekit/server";

const auth = server({ url: import.meta.env.CONVEX_URL });

export const handle: Handle = async ({ event, resolve }) => {
  const result = await auth.refresh(event.request);

  if (result.redirect) {
    return result.response;
  }

  const { cookies, token } = result;

  // Apply auth cookies to the response
  for (const cookie of cookies) {
    event.cookies.set(cookie.name, cookie.value, {
      path: cookie.path ?? "/",
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite as "lax" | "strict" | "none",
      maxAge: cookie.maxAge,
    });
  }

  // Make the token available to load functions
  event.locals.token = token;

  return withServerConvexToken(token ?? undefined, () => resolve(event));
};
```

`withServerConvexToken` makes the refreshed token available to
`convexLoad()` and `createConvexHttpClient()` for the lifetime of this request.
It uses request-local storage, so tokens never leak between SSR requests.

## Auth proxy route

Create `src/routes/api/auth/+server.ts` to handle client-side sign-in and
sign-out POST requests:

```ts
// src/routes/api/auth/+server.ts
import { server } from "@estifanos-sh/convex-auth/server";
import type { RequestHandler } from "./$types";

const auth = server({ url: import.meta.env.CONVEX_URL });

export const POST: RequestHandler = async ({ request }) => {
  return auth.proxy(request);
};
```

Point your client-side auth configuration to `/api/auth` so that sign-in and
sign-out calls are routed through this endpoint.

## Client setup

In your root layout, create the browser auth client with `proxyPath`, `token`,
and `location`, then bridge it into Svelte context:

```svelte
{/* src/routes/+layout.svelte */}
<script lang="ts">
  import { page } from "$app/state";
  import { setupConvex } from "convex-svelte";
  import { onDestroy, untrack } from "svelte";
  import { client as createAuthClient } from "@estifanos-sh/convex-auth/browser";
  import { useConvexAuth } from "@estifanos-sh/convex-auth/svelte";

  let { data, children } = $props();

  // These seed the long-lived clients once; later auth updates are reactive.
  const convex = setupConvex(untrack(() => data.convexUrl));

  const authClient = createAuthClient({
    convex,
    proxyPath: "/api/auth",
    token: untrack(() => data.auth.token) ?? null,
    location: () => page.url, // SSR-safe URL reading
  });
  const auth = useConvexAuth(authClient);
  onDestroy(() => authClient.destroy());
</script>
```

The hook shares reactive auth for this client. A non-empty `token` renders
`auth.signedIn` / `auth.token` on the first paint; `null` renders signed out
without a loading flash. Pass the same `authClient` to `useConvexAuth` in any
child. For SSR-safe URL parameters and invite handling use `authClient.param()`
and `authClient.invite`. See [SSR Overview](/ssr/overview/) for the full client
API.

## Live SSR queries

After adding the
[`convex-svelte` transport hooks](https://github.com/get-convex/convex-svelte#ssr-with-convexload--convexloadpaginated-recommended),
authenticated queries can load on the server and become live subscriptions
after hydration:

```ts
// src/routes/+page.ts
import { convexLoad } from "convex-svelte/sveltekit";
import { api } from "$convex/_generated/api.js";

export const load = async () => ({
  viewer: await convexLoad(api.users.viewer, {}),
});
```

The server hook above supplies the token automatically. On client navigation,
the same query uses the already-authenticated Convex client directly.

## Accessing the token

After the hook runs, you can access `event.locals.token` in any server load
function to pass the token to the client or to call Convex functions
server-side:

```ts
// src/routes/+layout.server.ts
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  return { token: locals.token };
};
```
