---
title: TanStack Start
description: Integrate convex-auth SSR with TanStack Start using server functions.
---

<svelte:head>

  <title>TanStack Start - convex-auth</title>
</svelte:head>

# TanStack Start

TanStack Start integration uses `createServerFn` to run auth refresh on the
server and pass the token to the client.

## Server function

Create a server function that calls `auth.refresh()` with the incoming request.
Use `getRequest()` to access the raw request and `setCookie()` to apply auth
cookies to the response.

```ts
// app/auth.server.ts
import { server } from "@estifanos-sh/convex-auth/server";
import { createServerFn } from "@tanstack/start";
import { getRequest, setCookie } from "@tanstack/start/server";

const auth = server({ url: process.env.CONVEX_URL! });

export const getAuthToken = createServerFn("GET", async () => {
  const request = getRequest();
  const result = await auth.refresh(request);

  if (result.redirect) {
    return result.response;
  }

  const { cookies, token } = result;

  // Apply auth cookies
  for (const cookie of cookies) {
    setCookie(cookie.name, cookie.value, {
      path: cookie.path ?? "/",
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite as "lax" | "strict" | "none",
      maxAge: cookie.maxAge,
    });
  }

  return { token };
});
```

## Using in a route

Call the server function from a loader to make the token available during SSR:

```ts
// app/routes/index.tsx
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getAuthToken } from "../auth.server";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const result = await getAuthToken();

    if (result instanceof Response) {
      throw redirect({ href: result.headers.get("Location") ?? "/" });
    }

    return { token: result.token };
  },
});
```

## Auth proxy

For client-side sign-in/sign-out, create a server function that proxies to
Convex:

```ts
// app/authProxy.server.ts
import { server } from "@estifanos-sh/convex-auth/server";
import { createServerFn } from "@tanstack/start";
import { getRequest } from "@tanstack/start/server";

const auth = server({ url: process.env.CONVEX_URL! });

export const authProxy = createServerFn("POST", async () => {
  const request = getRequest();
  return auth.proxy(request);
});
```
