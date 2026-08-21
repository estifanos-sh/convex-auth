---
title: Installation
description: Add Convex Auth to a Convex application.
---

<svelte:head>

  <title>Installation</title>
</svelte:head>

# Installation

Install Convex Auth while `convex dev` is running, then launch the setup wizard.
The wizard registers the component, creates the server definition and HTTP
routes, and configures Convex to trust sessions issued by Convex Auth.

```bash
npm install @estifanos-sh/convex-auth
npx convex dev
npx convex-auth
```

Pass the application URL when the wizard cannot infer it:

```bash
npx convex-auth --app-url "http://localhost:5173"
```

The generated files are the normal integration surface. Keep provider secrets
and `defineAuth` in `convex/auth.ts`. Import the lightweight auth context from
`convex/auth/core.ts` in ordinary queries and mutations. Mount the generated
HTTP routes, and leave `convex/auth.config.ts` in place so native Convex identity
resolution trusts Convex Auth.

## Configure one provider

Provider configuration belongs in the application because credentials and
delivery services belong to the application. Convex Auth does not reserve
environment-variable names or bundle an email vendor. This example uses GitHub,
but the surrounding architecture is the same for every provider.

```ts
// convex/auth.ts
import { github } from "@estifanos-sh/convex-auth/providers";
import { defineAuth } from "@estifanos-sh/convex-auth/server";
import { components } from "./_generated/api";
import { env } from "./_generated/server";

export const auth = defineAuth(components.auth, {
  providers: [
    github({
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    }),
  ],
});

export const { signIn, signOut, store } = auth;
```

`signIn` and `signOut` are the client-facing actions. `store` is exported for
the auth runtime; frontend code should not call it. Pass `api.auth` to the
client SDK and let the client complete provider redirects and continuations.

## Protect application functions

Create the lightweight context once and use it to define the builders for
authenticated application functions.

```ts
// convex/auth/core.ts
import { createAuthContext } from "@estifanos-sh/convex-auth/core";
import { components } from "../_generated/api";

export const auth = createAuthContext(components.auth);
```

```ts
// convex/functions.ts
import { customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth/core";

export const authQuery = customQuery(query, auth.ctx());
export const authMutation = customMutation(mutation, auth.ctx());
```

Handlers created with these builders receive `ctx.auth.userId` and
`ctx.auth.user`. Store the `userId` on product documents that belong to a user.
Do not add password, account, session, passkey, or recovery tables to the
application schema; those records already belong to the component.

## What to change after setup

Most applications only need to add providers, configure permissions, and wrap
their protected functions. The generated `auth.config.ts` and HTTP mounting are
protocol wiring, not extension points. Read [How Convex Auth works](/reference/architecture)
before changing the generated structure or creating any app-owned auth state.
