---
title: Next.js
description: Integrate convex-auth SSR with Next.js using middleware or server components.
---

<svelte:head>

  <title>Next.js - convex-auth</title>
</svelte:head>

# Next.js

Next.js integration uses middleware to refresh tokens on every request and the
`cookies()` API from `next/headers` to apply auth cookies.

## Middleware

The recommended approach is to call `auth.refresh()` in `middleware.ts`. This
runs on every request before your pages render.

```ts
// middleware.ts
import { server } from "@estifanos-sh/convex-auth/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const auth = server({ url: process.env.CONVEX_URL! });

export async function middleware(request: NextRequest) {
  const result = await auth.refresh(request);

  if (result.redirect) {
    return result.response;
  }

  const { cookies, token } = result;

  const response = NextResponse.next();

  // Apply auth cookies
  for (const cookie of cookies) {
    response.cookies.set(cookie.name, cookie.value, {
      path: cookie.path ?? "/",
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite as "lax" | "strict" | "none",
      maxAge: cookie.maxAge,
    });
  }

  // Pass token via header for server components
  if (token) {
    response.headers.set("x-convex-token", token);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

## Auth proxy route

Create `app/api/auth/route.ts` to handle client-side sign-in and sign-out:

```ts
// app/api/auth/route.ts
import { server } from "@estifanos-sh/convex-auth/server";

const auth = server({ url: process.env.CONVEX_URL! });

export async function POST(request: Request) {
  return auth.proxy(request);
}
```

## Server component usage

In a server component or layout, read the token from cookies using
`next/headers` and pass it into your app-owned client auth provider:

```ts
// app/layout.tsx
import { cookies } from "next/headers";
import { AuthProvider } from "./auth-provider";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get("convex-auth-token")?.value ?? null;

  return (
    <html>
      <body>
        <AuthProvider token={token}>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

`AuthProvider` is your client component that owns the Convex and auth clients:

```tsx
// app/auth-provider.tsx
"use client";

import { useEffect, useMemo } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { client as createAuthClient } from "@estifanos-sh/convex-auth/browser";

export function AuthProvider({
  token,
  children,
}: {
  token: string | null;
  children: React.ReactNode;
}) {
  const { convex, authClient } = useMemo(() => {
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;
    const convexClient = new ConvexReactClient(convexUrl);
    const authClient = createAuthClient({
      convex: convexClient,
      proxyPath: "/api/auth",
      token,
    });
    return { convex: convexClient, authClient };
  }, [token]);

  useEffect(() => () => authClient.destroy(), [authClient]);

  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
```

The `token` option seeds the synchronous boot: a non-empty token renders signed
in on hydration, and `null` renders signed out without a loading flash. Pass
this app-owned `authClient` to `useAuth`, `SignedIn`, `SignedOut`, and
`AuthLoading` in client components. See [SSR overview](/ssr/overview).
