---
title: How Convex Auth works
description: The ownership model behind Convex Auth and your application.
---

<svelte:head>

  <title>How Convex Auth works</title>
</svelte:head>

# How Convex Auth works

Convex Auth is the authentication system for your application, not a collection
of helpers for building a second authentication system beside it. Once the
component is installed, it owns identities, sign-in accounts, credentials,
verification state, sessions, refresh tokens, passkeys, recovery state, and the
security rules that connect those records.

Your application owns product data. A document such as a project, message, or
invoice records the Convex Auth `userId` of the person who owns it. The app does
not copy the user, inspect password hashes, manufacture sessions, or keep a
parallel account record in sync.

| Convex Auth owns                             | Your application owns                       |
| -------------------------------------------- | ------------------------------------------- |
| Users and linked sign-in accounts            | Product profiles and preferences            |
| Passwords, PINs, passkeys, and TOTP          | Projects, documents, and other domain data  |
| Verification, enrollment, and recovery state | References to an auth `userId` or `groupId` |
| Sessions, refresh tokens, and API keys       | The authorization rules around product data |

This boundary is the most important part of the architecture. It keeps account
recovery consistent with sign-in, makes revocation apply everywhere, and lets
new authentication methods resolve to the same identity without migrations in
your application schema.

## One identity through every sign-in method

A provider proves something about a person: an OAuth account belongs to them, a
password is correct, or a passkey ceremony succeeded. Convex Auth links that
proof to an account and resolves the account to one stable `userId`. It then
issues a session. Convex trusts the session JWT, and `auth.ctx()` resolves it
into `ctx.auth` before your handler runs.

That means application code is independent of how the person signed in. A
password user, a GitHub user, and an enterprise SSO user all reach the same
handler with the same `ctx.auth.userId`. Email and provider account IDs are
attributes of an identity; neither is a safe replacement for `userId`.

```ts
export const create = authMutation({
  args: { title: v.string() },
  handler: async (ctx, args) => {
    return ctx.db.insert("projects", {
      title: args.title,
      ownerId: ctx.auth.userId,
    });
  },
});
```

Do not accept `ownerId` or `userId` from the browser when the value means “the
current user.” Derive it from `ctx.auth`. A client-provided identity turns an
authentication decision into untrusted input.

## The application boundary

Convex components have isolated storage. The browser cannot call component
functions directly, and the component cannot read your application tables.
`defineAuth` creates the typed server facade that crosses this boundary. The
exported `signIn` and `signOut` actions drive the client flow; the remaining
`auth.*` namespaces are server APIs for your Convex functions.

Queries and mutations should import the lightweight context created by
`createAuthContext`. Wire `auth.ctx()` into custom builders once, then use those
builders throughout the app. This rejects unauthenticated callers before your
business handler runs and avoids loading provider and cryptography code into
every function bundle.

```ts
// convex/functions.ts
import { customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth/core";

export const authQuery = customQuery(query, auth.ctx());
export const authMutation = customMutation(mutation, auth.ctx());
```

Use `auth.ctx.optional()` only for a genuinely public handler whose response
changes when a viewer is signed in. Authentication-required code should use the
required builder so a missing identity cannot become an overlooked branch.

## Extend the system instead of duplicating it

An application-owned `Users` table that mirrors auth users is usually the first
sign that the boundary has been crossed. Tables for password or PIN hashes,
passkeys, verification codes, login challenges, recovery codes, account locks,
restricted sessions, or session handoffs go further: together they recreate an
authentication protocol that Convex Auth can no longer revoke or reason about
as one system.

Use a provider when the application needs another way to prove identity. Use a
typed provider operation or continuation when one proof must lead into another
ceremony, such as password recovery followed by passkey rotation. A continuation
keeps its authorization ticket inside Convex Auth and delays the normal session
until the complete flow succeeds. Do not issue an ordinary session and recreate
“restricted session” semantics in an application table.

Use `defineAuth({ extend })` for small application fields that must travel with
the auth user. Keep richer public profiles and product settings in an app table
keyed by `userId`; they are product data, not another identity record. Use the
`auth.user`, `auth.account`, `auth.session`, and related facades for administrative
operations instead of calling generated component functions directly.

## Authorization is a separate decision

Authentication answers who is calling. Authorization answers what that user may
do with your product data. For user-owned data, compare the stored owner ID with
`ctx.auth.userId`. For group access, define typed grants with
`definePermissions`, assign roles through Convex Auth memberships, and check
grants rather than role names.

This separation does not require another session or identity table. The session
establishes the user; your handler applies the business rule. If access changes,
update ownership, membership, or grants at the layer where that rule belongs.

## The complete runtime

`defineAuth` is the composition root for providers, permissions, and protocol
routes. `createAuthContext` is its lightweight companion for ordinary Convex
handlers. `auth.config.ts` tells Convex to trust JWTs issued from
`${CONVEX_SITE_URL}/auth`, while `auth.http()` mounts OAuth callbacks, JWKS, and
other protocol routes. The component performs expiration cleanup itself.

Most applications should interact with this system in only three places: one
auth definition, one shared pair of authenticated function builders, and a
client created with `api.auth`. Everything else should be application code that
reads `ctx.auth.userId` and works with product data.
