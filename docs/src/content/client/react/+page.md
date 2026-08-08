---
title: React
description: Gate components and useAuthActions for React apps.
---

<svelte:head>

  <title>React - convex-auth</title>
</svelte:head>

# React

`@estifanos-sh/convex-auth/react` exposes React context, gate components, and hooks
for an app-owned browser auth client. Use it in React, Next.js, Vite, and
similar apps; it works in any React 18+ codebase.

`react` is **not** a declared peer dependency — if your app uses this subpath,
you already have React installed. Apps that only consume the server entrypoints
don't pay for React.

## Setup

Create the Convex client and auth client together, then pass the auth client to
`<ConvexAuthProvider>`.

```tsx
// app.tsx
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { client as createAuthClient } from "@estifanos-sh/convex-auth/browser";
import { ConvexAuthProvider } from "@estifanos-sh/convex-auth/react";
import { api } from "../convex/_generated/api";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
const convex = new ConvexReactClient(convexUrl);
const auth = createAuthClient({ convex, url: convexUrl, api: api.auth });

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

## Gate components

Render UI per auth state. `<SignedIn>` accepts a render prop that receives the
JWT (typed `string`). `<AuthLoading>` renders while auth is resolving or while a
new token is waiting for Convex confirmation.

```tsx
import { SignedIn, SignedOut, AuthLoading, useAuthActions } from "@estifanos-sh/convex-auth/react";

function App() {
  const { signIn } = useAuthActions();
  return (
    <>
      <AuthLoading>
        <span>Loading…</span>
      </AuthLoading>
      <SignedOut>
        <button onClick={() => signIn?.("google")}>Sign in with Google</button>
      </SignedOut>
      <SignedIn>{(token) => <Dashboard token={token} />}</SignedIn>
    </>
  );
}
```

Because the browser client boots synchronously from persisted storage, a
returning user can render `<SignedIn>` on the first paint. Fresh sign-in and
refresh tokens render `<AuthLoading>` until Convex confirms them.

## `useAuthActions()`

Returns `{ signIn, signOut }`. Members are `undefined` only when no auth client
has been provided.

```tsx
import { useAuthActions } from "@estifanos-sh/convex-auth/react";

function SignOutButton() {
  const { signOut } = useAuthActions();
  return <button onClick={() => signOut?.()}>Sign out</button>;
}
```

## `useConvexAuthClient()`

The underlying imperative client, for factor flows (`totp`, `webauthn`,
`device`) and low-level methods (`completeOAuth`, `param`, `initialize`).
Throws when no auth client has been provided.

```tsx
import { useConvexAuthClient } from "@estifanos-sh/convex-auth/react";

function TotpSetup() {
  const client = useConvexAuthClient();
  return <button onClick={() => client.totp?.setup()}>Enable TOTP</button>;
}
```

`client.totp`, `client.webauthn`, `client.device` are present only when the
underlying providers are configured server-side.

## SSR

Create the auth client with the server-known `token`, then pass it to
`<ConvexAuthProvider auth={auth}>`. For framework-specific token-prefetch
helpers, see [SSR overview](/ssr/overview).
