# @estifanos-sh/convex-auth

Authentication and authorization for Convex applications.

This is a preview release. Install it from the `preview` channel:

```sh
pnpm add @estifanos-sh/convex-auth@preview
```

Configure the component in `convex/convex.config.ts`:

```ts
import auth from "@estifanos-sh/convex-auth/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(auth);

export default app;
```

Then define your providers and permissions with `defineAuth`:

```ts
import { definePermissions } from "@estifanos-sh/convex-auth/permissions";
import { password, webauthn } from "@estifanos-sh/convex-auth/providers";
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
```

Read the [installation guide](https://estifanos.sh/convex-auth/getting-started/installation/)
for the complete setup, generated files, environment variables, client bindings,
and provider configuration.

## Links

- [Documentation](https://estifanos.sh/convex-auth/)
- [Source](https://github.com/estifanos-sh/convex-auth)
- [Issues](https://github.com/estifanos-sh/convex-auth/issues)

Apache-2.0
