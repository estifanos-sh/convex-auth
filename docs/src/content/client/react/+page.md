---
title: React
description: Reactive auth state and gates for React apps.
---

<svelte:head>

  <title>React - convex-auth</title>
</svelte:head>

# React

`@estifanos-sh/convex-auth/react` exposes a state hook and gate components for
an app-owned browser auth client. Use it in React, Next.js, Vite, and similar
apps; it works in any React 18+ codebase.

`react` is **not** a declared peer dependency — if your app uses this subpath,
you already have React installed. Apps that only consume the server entrypoints
don't pay for React.

## Setup

Create the Convex client and auth client together. Pass that same inferred
client to every auth hook and gate.

```tsx
// app.tsx
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { client as createAuthClient } from "@estifanos-sh/convex-auth/browser";
import { AuthLoading, SignedIn, SignedOut, useAuth } from "@estifanos-sh/convex-auth/react";
import { api } from "../convex/_generated/api";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
const convex = new ConvexReactClient(convexUrl);
const authClient = createAuthClient({ convex, url: convexUrl, api: api.auth });

export function Root() {
  return (
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  );
}
```

`api.auth` is the generated client contract for the `signIn` and `signOut`
actions exported by `convex/auth.ts`. Pass it directly so `authClient` retains
configured provider IDs, validated sign-in parameters, and enabled factor
helpers without a manual generic or API-reference type.

## Gate components

Pass `authClient` to each gate. `<SignedIn>` accepts a render prop that receives
the JWT; `<AuthLoading>` renders while auth is resolving or while a new token is
waiting for Convex confirmation. Call sign-in directly on `authClient`.

```tsx
function App() {
  return (
    <>
      <AuthLoading client={authClient}>
        <span>Loading…</span>
      </AuthLoading>
      <SignedOut client={authClient}>
        <button onClick={() => authClient.signIn("google")}>Sign in with Google</button>
      </SignedOut>
      <SignedIn client={authClient}>{(token) => <Dashboard token={token} />}</SignedIn>
    </>
  );
}
```

Because the browser client boots synchronously from persisted storage, a
returning user can render `<SignedIn>` on the first paint. Fresh sign-in and
refresh tokens render `<AuthLoading>` until Convex confirms them.

## `useAuth(authClient)`

Use `useAuth(authClient)` when the component needs the current discriminated
state. The app-owned client remains the place for `signIn`, `signOut`, and any
configured factor helper.

```tsx
function AccountMenu() {
  const auth = useAuth(authClient);
  if (auth.status !== "signedIn") return null;
  return <button onClick={() => authClient.signOut()}>Sign out</button>;
}
```

If TOTP, WebAuthn, or device flow is configured, call its helper directly on
`authClient`, where its availability remains inferred from `api.auth`.

## SSR

Create the auth client with the server-known `token`, then pass that same client
to gates and `useAuth`. For framework-specific token-prefetch helpers, see
[SSR overview](/ssr/overview).
