# Server scaffold

Use these templates only after verifying the named exports exist in the
installed `@estifanos-sh/convex-auth` version. Merge them into existing files rather
than replacing unrelated component or HTTP registrations.

## Register the component

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import auth from "@estifanos-sh/convex-auth/convex.config";

const app = defineApp();
app.use(auth);

export default app;
```

Preserve other `app.use(...)` calls. When the application reads environment
values directly, declare only those application-owned values in `defineApp`.

## Define authentication once

```ts
// convex/auth.ts
import { defineAuth } from "@estifanos-sh/convex-auth/server";
import { password } from "@estifanos-sh/convex-auth/providers";
import { components } from "./_generated/api";

const auth = defineAuth(components.auth, {
  providers: [password()],
});

export { auth };
export const { signIn, signOut, store } = auth;
```

Use `defineAuth` as the single definition. Add permissions, OAuth-server
configuration, and providers to this object instead of creating parallel auth
factories.

## Mount HTTP routes

```ts
// convex/http.ts
import { auth } from "./auth";

export default auth.http();
```

If an HTTP router already exists, inspect the installed type for the supported
mounting form and preserve existing routes. Confirm `/auth/.well-known/jwks.json`
and `/auth/.well-known/openid-configuration` respond after deployment.

## Trust issued JWTs

```ts
// convex/auth.config.ts
import { env } from "./_generated/server";

export default {
  providers: [
    {
      domain: `${env.CONVEX_SITE_URL}/auth`,
      applicationID: "convex",
    },
  ],
};
```

This trust configuration is independent from the `providers` configured in
`defineAuth`. Missing it commonly produces a browser session whose identity is
never accepted by Convex functions.

## Create the lightweight function context

```ts
// convex/auth/core.ts
import { createAuthContext } from "@estifanos-sh/convex-auth/core";
import { components } from "../_generated/api";

export const auth = createAuthContext(components.auth);
```

Import this lightweight context from queries and mutations. Keep provider,
OAuth, email, and cryptographic initialization in the canonical `auth.ts`
bundle.
