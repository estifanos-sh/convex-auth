# vNext Migration Guide

This release makes the public API match Convex function conventions:
definition-first setup, object args, explicit primary IDs, native pagination,
application-owned provider configuration, and permissions-first group
authorization.

This is a hard breaking cut: removed names are not kept as compatibility aliases.

## WebAuthn provider and client

The protocol-level provider and client surface is now named `webauthn`.
Credential resources remain passkeys in storage, while current-user management
moves to the sanitized `auth.factor` namespace. The Account
credential-resource identifier remains `passkey`.

```ts
// Before
providers: [passkey()];
await client.passkey.signIn();

// After
providers: [webauthn()];
await client.webauthn.signIn();
```

Provider preferences are grouped by ceremony under `registration` and
`authentication`. Existing Passkey and Account credential storage is preserved;
no data migration is required.

## Setup: `defineAuth` and `definePermissions`

The preferred vNext setup surface is `defineAuth`. It keeps providers,
permissions, table extensions, and HTTP intent on one typed auth definition.

```ts
// Before
import { defineRoles } from "@estifanos-sh/convex-auth/authorization";
import { createAuth } from "@estifanos-sh/convex-auth/server";

export const roles = defineRoles({
  admin: {
    label: "Admin",
    grants: ["members.read", "sso.connection.manage"],
  },
});

export const auth = createAuth(components.auth, {
  providers: [password()],
  authorization: { roles },
});
```

```ts
// vNext
import { defineAuth } from "@estifanos-sh/convex-auth/server";
import { definePermissions } from "@estifanos-sh/convex-auth/permissions";

export const permissions = definePermissions({
  grants: ["members.read", "sso.connection.manage"],
  roles: {
    admin: {
      label: "Admin",
      grants: ["members.read", "sso.connection.manage"],
    },
  },
});

export const auth = defineAuth(components.auth, {
  providers: [password()],
  permissions,
});
```

`permissions` names the configured permission system. Its `grants` are the
atomic strings checked by app code, while `roles` are named bundles assigned to
memberships and invites. `authorization: { roles }` was removed with the old
setup vocabulary.

## Object args everywhere

Primary entity IDs now use `{ id }`. Batch reads use `{ ids }`. Foreign keys
keep their entity prefix, such as `{ userId }` or `{ groupId }`.

```ts
// Before
await auth.user.get(ctx, userId);
await auth.user.update(ctx, userId, patch);
await auth.key.verify(ctx, secret);

// vNext
await auth.user.get(ctx, { id: userId });
await auth.user.update(ctx, { id: userId, patch });
await auth.key.verify(ctx, { secret });
```

## Native pagination

Unbounded list APIs now accept `paginationOpts` and return Convex's
`PaginationResult` shape.

```ts
// Before
const { items, nextCursor } = await auth.user.list(ctx, {
  limit: 25,
  cursor,
});

// vNext
const { page, isDone, continueCursor } = await auth.user.list(ctx, {
  paginationOpts: { numItems: 25, cursor },
});
```

Pass the same args directly to `usePaginatedQuery` for component-backed
functions.

## Filters and payloads

List filters live under `where`, create payloads use `data`, update payloads
use `patch`, and update payload validators are partial.

```ts
await auth.member.update(ctx, {
  id: memberId,
  patch: { roleIds: ["support"] },
});

const pending = await auth.invite.list(ctx, {
  where: { groupId, status: "pending" },
  paginationOpts: { numItems: 25, cursor: null },
});
```

## Application-owned provider environment

Declare provider and delivery-service values in the application definition and
pass them to the provider that uses them. Convex Auth does not prescribe or
read provider credential names.

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import { v } from "convex/values";
import auth from "@estifanos-sh/convex-auth/convex.config";

const app = defineApp({
  env: {
    GITHUB_CLIENT_ID: v.string(),
    GITHUB_CLIENT_SECRET: v.string(),
  },
});
app.use(auth, { name: "auth" });

export default app;
```

```ts
import { env } from "./_generated/server";

const github = {
  clientId: env.GITHUB_CLIENT_ID,
  clientSecret: env.GITHUB_CLIENT_SECRET,
};
```

## Connection (SSO) admin APIs

There is no mount layer. Group connection admin is exposed exactly like the rest
of your app: write `authMutation`/`authQuery` functions that authorize with
`auth.member.assert` and call the flat `auth.connection.*` facade. `groupId` and
`connectionId` are arguments, not path segments.

```ts
// Before — bespoke mount surface (removed)
export const sso = auth.sso.mount({
  access: async (ctx, input) => {
    /* … */
  },
});
export const configureOidc = sso.admin.oidc.configure;
export const configureScim = sso.admin.scim.configure;
```

```ts
// Now — convex/auth/group.ts: the same authMutation pattern as the rest of your app
import { v } from "convex/values";
import { authMutation } from "../functions";
import { auth } from "../auth";
import { roles } from "../roles";

export const createConnection = authMutation({
  args: { groupId: v.string(), protocol: v.union(v.literal("oidc"), v.literal("saml")) },
  handler: async (ctx, args) => {
    await auth.member.assert(ctx, {
      userId: ctx.auth.userId,
      groupId: args.groupId,
      roleIds: [roles.orgAdmin.id],
    });
    return auth.connection.create(ctx, args);
  },
});

export const setOidc = authMutation({
  args: { connectionId: v.string() /* discovery, client, … */ },
  handler: async (ctx, args) => {
    const { groupId } = await auth.connection.get(ctx, { id: args.connectionId });
    await auth.member.assert(ctx, {
      userId: ctx.auth.userId,
      groupId,
      roleIds: [roles.orgAdmin.id],
    });
    return auth.connection.oidc.upsert(ctx, args);
  },
});

export const setScim = authMutation({
  args: { connectionId: v.string() },
  handler: async (ctx, args) => {
    const { groupId } = await auth.connection.get(ctx, { id: args.connectionId });
    await auth.member.assert(ctx, {
      userId: ctx.auth.userId,
      groupId,
      roleIds: [roles.orgAdmin.id],
    });
    return auth.connection.scim.upsert(ctx, args);
  },
});
```

Expose only the helpers your app's UI calls. Use Convex-native args: `{ id }` for
the primary record, `{ connectionId }` for a foreign key, `{ data }` for create
payloads, `{ patch }` for update payloads, and `paginationOpts` for unbounded
lists.

## HTTP and routing

Keep app-owned HTTP routes explicit. Register the auth component once and
mount the protocol routes from the app's `convex/http.ts`. Configure a nondefault
auth path on `defineAuth({ path })`; it is not a component `httpPrefix` option.

```ts
// convex/convex.config.ts
const app = defineApp();
app.use(authComponent);
```

```ts
// convex/http.ts
const http = auth.http();
export default http;
```

Route helpers such as `auth.request.context(...)` and
`auth.request.route(...)` remain the way to protect app-owned HTTP handlers.

## Naming summary

Use `defineAuth` and `definePermissions`, not the removed
`authorization: { roles }` setup. Primary rows use `id`, batch reads use
`ids`, and foreign keys keep their entity prefix such as `userId`. Lists use
`where` and `paginationOpts`; creates take `data`, while updates take `patch`.
