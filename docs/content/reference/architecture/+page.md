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

In practical terms, Convex Auth owns users and every mechanism that proves or
maintains their identity. Your application owns profiles, preferences, projects,
documents, and the authorization rules around that product data. Product tables
refer to the branded auth `userId` or `groupId`; they do not mirror auth records.
This boundary keeps recovery consistent with sign-in, makes revocation apply to
every access path, and lets a new provider resolve to the same identity without
an application-schema migration.

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
`auth.*` namespaces are server APIs for your Convex functions. Application code
should use this facade, not generated component functions. Generated component
references are an implementation boundary and may expose storage-oriented
shapes that are deliberately absent from the public API.

Queries and mutations should import the configured `auth` value and wire
`auth.ctx()` into custom builders once. This rejects unauthenticated callers
before business handlers run and gives every protected function the same
current auth snapshot.

```ts
// convex/functions.ts
import { customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";

export const authQuery = customQuery(query, auth.ctx());
export const authMutation = customMutation(mutation, auth.ctx());
```

Use `auth.ctx.optional()` only for a genuinely public handler whose response
changes when a viewer is signed in. Authentication-required code should use the
required builder so a missing identity cannot become an overlooked branch.

`auth.ctx()` validates the session and resolves one coherent snapshot containing
the user, active group, active membership, role, and grants. Reuse that
snapshot. Calling `auth.user.viewer`, `auth.group.active.get`, or
`auth.member.get` immediately afterward repeats component and database work
without making authorization more current.

```ts
export const list = authQuery({
  args: {},
  handler: async (ctx) => {
    const { userId, groupId, grants } = ctx.auth;
    return listVisibleProjects(ctx, { userId, groupId, grants });
  },
});
```

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

Directory screens are another place where applications often leak the component
boundary. Resolve the authorized user IDs in application code, then ask the
facade for their redacted provider capabilities in one bounded component call.
The batch API does not authorize that directory for you; the calling function
must establish that the viewer may inspect those users before supplying their
IDs.

```ts
ctx.auth.assert("members.read");

const accounts = await auth.account.list(ctx, {
  userIds: members.map((member) => member.userId),
  provider: "password",
});

const usersWithPasswords = new Set(accounts.map((account) => account.userId));
```

These summaries contain branded account and user IDs plus non-secret capability
metadata. Provider account identifiers, hashes, credential secrets, and provider
extensions never cross this surface.

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

`defineAuth` is the composition root for providers, permissions, protocol
routes, and the server facade used by ordinary Convex handlers. `auth.config.ts`
tells Convex to trust JWTs issued from
`${CONVEX_SITE_URL}/auth`, while `auth.http()` mounts OAuth callbacks, JWKS, and
other protocol routes. The component performs expiration cleanup itself.

Most applications should interact with this system in only three places: one
auth definition, one shared pair of authenticated function builders, and a
client created with `api.auth`. Everything else should be application code that
reads `ctx.auth.userId` and works with product data.

## Tests use the same identity model

Tests should not invent an ID with a type assertion or call private component
mutations to manufacture a partial session. `createAuthTest` creates real,
branded auth records and returns the identity claims expected by
`convex-test`. The test can therefore exercise expiry, revocation, membership,
and active-group behavior through the same component boundary as production.

```ts
import { createAuthTest, register } from "@estifanos-sh/convex-auth/test";

const t = convexTest(schema);
register(t);
const fixture = createAuthTest(t, components.auth);

const userId = await fixture.user.create({
  data: { email: "alice@example.com" },
});
const { identity } = await fixture.session.create({ userId });
const result = await t.withIdentity(identity).query(api.projects.list, {});
```

See [Testing](/guides/testing) for a reusable application test setup.
