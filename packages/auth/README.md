# @estifanos-sh/convex-auth

Authentication and authorization for Convex applications.

Install the published package:

```sh
npm install @estifanos-sh/convex-auth
```

Configure the component in `convex/convex.config.ts`:

```ts
import auth from "@estifanos-sh/convex-auth/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    CONVEX_SITE_URL: v.string(),
  },
});
app.use(auth);

export default app;
```

Then define your providers and permissions with `defineAuth`:

```ts
import { definePermissions } from "@estifanos-sh/convex-auth/permissions";
import { password } from "@estifanos-sh/convex-auth/providers/password";
import { webauthn } from "@estifanos-sh/convex-auth/providers/webauthn";
import { defineAuth } from "@estifanos-sh/convex-auth/server";
import { components } from "./_generated/api";

const permissions = definePermissions({
  grants: [],
  roles: {},
});

export const auth = defineAuth(components.auth, {
  permissions,
  providers: [password(), webauthn()],
});

export const { signIn, signOut, store } = auth;
```

Pass the generated actions directly to the browser client. The provider IDs,
custom credential validators, action results, and enabled factor helpers are
inferred without a generic or type assertion.

```ts
import { client } from "@estifanos-sh/convex-auth/browser";
import { api } from "../convex/_generated/api";

export const authClient = client({ convex, api: api.auth });
```

Convex Auth owns users, provider accounts, credential secrets, passkeys,
recovery continuations, and sessions. Application tables should reference the
branded auth `userId`; they should not mirror those records or manufacture auth
IDs in tests.

Read the [installation guide](https://estifanos.sh/convex-auth/getting-started/installation/)
for the complete setup, generated files, environment variables, client bindings,
and provider configuration.

## Links

Read the [documentation](https://estifanos.sh/convex-auth/), browse the
[source](https://github.com/estifanos-sh/convex-auth), or report an
[issue](https://github.com/estifanos-sh/convex-auth/issues).

Apache-2.0
