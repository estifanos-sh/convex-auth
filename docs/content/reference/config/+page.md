---
title: Configuration
description: defineAuth options reference.
---

<script>
  import Card from '$lib/components/docs/Card.svelte';
  import CardGrid from '$lib/components/docs/CardGrid.svelte';
</script>

<svelte:head>

  <title>Configuration - convex-auth</title>
</svelte:head>

# Configuration

## `defineAuth(component, config)`

`defineAuth` is the one application auth definition. Providers, permissions,
table extensions, and protocol routes live on this typed composition root so a
user has one identity and one session lifecycle regardless of how they sign in.

```ts
import { authEvents, defineAuth } from "@estifanos-sh/convex-auth/server";
import { definePermissions } from "@estifanos-sh/convex-auth/permissions";
import { password } from "@estifanos-sh/convex-auth/providers";
import { components } from "./_generated/api";
import { v } from "convex/values";

const permissions = definePermissions({
  grants: ["members.read", "sso.connection.manage"],
  roles: {
    member: {
      label: "Member",
      grants: ["members.read"],
    },
    admin: {
      label: "Admin",
      grants: ["members.read", "sso.connection.manage"],
    },
  },
});

const auth = defineAuth(components.auth, {
  providers: [password()],
  permissions,
  extend: {
    User: v.object({ stripeCustomerId: v.optional(v.string()) }),
    GroupInvite: v.object({ campaign: v.optional(v.string()) }),
  },
  session: {
    totalDurationMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    inactiveDurationMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
  jwt: {
    durationMs: 60 * 1000, // 1 minute
  },
  signIn: {
    maxFailedAttemptsPerHour: 10,
  },
  events: authEvents.handlers({
    user: {
      created: async (ctx, event) => {
        await enqueueOnboarding(ctx, { userId: event.subject.id });
      },
    },
    password: {
      changed: async (ctx, event) => {
        await auditPasswordChange(ctx, { userId: event.subject.id });
      },
    },
  }),
  path: "/auth",
});
```

## Config options

| Option                            | Type                                                              | Default   | Description                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `providers`                       | `AuthProviderConfig[]`                                            | required  | Auth methods to enable                                                                                                                                                 |
| `permissions`                     | `PermissionsDefinition`                                           | `{}`      | App-defined grants and role bundles from `definePermissions(...)`.                                                                                                     |
| `extend`                          | `{ User?, Group?, GroupMember?, GroupInvite? }` Convex validators | `{}`      | Validator for each table's `extend` field. Types `auth.v.*` (so `viewer.extend.<field>` is typed) and validates return shapes.                                         |
| `session.totalDurationMs`         | `number`                                                          | 30 days   | Maximum session lifetime                                                                                                                                               |
| `session.inactiveDurationMs`      | `number`                                                          | varies    | Inactive session timeout                                                                                                                                               |
| `jwt.durationMs`                  | `number`                                                          | 60s       | JWT token lifetime                                                                                                                                                     |
| `signIn.maxFailedAttemptsPerHour` | `number`                                                          | 10        | Failed sign-in throttle (backed by `@convex-dev/rate-limiter` token bucket; resets on successful sign-in)                                                              |
| `events`                          | `AuthEventHandlerMap`                                             | —         | Lifecycle handlers from `authEvents.handlers(...)`; event kinds and their audit categories are canonical library taxonomy.                                             |
| `path`                            | `string`                                                          | `"/auth"` | HTTP path where the app-owned auth protocol routes are mounted. Provider callbacks, the JWT issuer, OAuth discovery, and `auth.request.mount(http)` all use this path. |

> **Note:** Email transport is configured via `email({ from, send })` in the
> providers array, not as a top-level config option.

See [Authorization Patterns](/guides/authorization) for the recommended
authorization model.

## Return value

`defineAuth` returns one composition root with three kinds of capabilities. The
client actions, `signIn` and `signOut`, are exported from the application's auth
module. `store` is runtime plumbing for exchanging session tokens and is not a
frontend API.

The entity namespaces—`auth.user`, `auth.session`, `auth.account`,
`auth.factor`, `auth.group`, `auth.member`, `auth.invite`, and `auth.key`—are
server facades over component-owned state. They exist so application functions
can perform an intentional administrative or current-user operation without
calling generated component internals.

`auth.provider` coordinates providers, including verifier-bound continuations
that deliberately postpone session issuance. `auth.request` resolves identity
at raw HTTP boundaries, and `auth.http()` mounts the authentication protocol
routes. When the `connection()` provider is configured, `auth.connection`
provides the private group SSO administration facade.

The returned `auth.v` validators describe public read results for Convex
`returns:` validation and carry configured extension fields. Derive a named
document type from a configured validator only when a separate annotation is
actually needed. The exported `signIn` and `signOut` actions become the
generated `api.auth` client contract; passing that object to the browser, Expo,
or framework client carries provider IDs, validated sign-in parameters, and
enabled factor helpers automatically. See [Typed Returns](/reference/typed-returns)
for the validator and type relationship.

Do not call generated component functions from application code and do not
build a parallel account, password, session, passkey, or recovery table. The
facade owns those security records so every provider, revocation, and recovery
operation reaches the same user lifecycle.

## Per-provider OAuth options

OAuth provider factories (`google`, `github`, `apple`, `microsoft`,
`custom`) accept these common options in addition to provider-specific
fields:

| Option                 | Type                        | Default           | Description                                                                                                                                                             |
| ---------------------- | --------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redirectUri`          | `string`                    | derived           | Callback URL override. Defaults to `${CONVEX_SITE_URL}/auth/callback/<provider>`.                                                                                       |
| `scopes`               | `string[]`                  | provider-default  | OAuth scopes requested at the authorize step.                                                                                                                           |
| `accountLinking`       | `"verifiedEmail" \| "none"` | `"verifiedEmail"` | On first sign-in, link to an existing user if the verified email matches.                                                                                               |
| `updateProfileOnLogin` | `boolean`                   | `true`            | On a returning sign-in, refresh `User.name`/`image`/`email` from the new profile. Set `false` if your app owns the canonical profile. Behavior matches Auth.js / Clerk. |

For SSO connections, the equivalent of `updateProfileOnLogin` lives on the
group connection policy under
`policy.provisioning.user.updateProfileOnLogin`.

## API layers

<CardGrid>
  <Card title="Auth-flow actions">
    `signIn` and `signOut` are the app-facing Convex functions used by the frontend auth
    client.
  </Card>
  <Card title="Helper namespaces">
    `auth.*`, `auth.connection.*`, and `auth.connection.scim.*` are server-side helper APIs for
    your Convex code.
  </Card>
  <Card title="App-owned admin RPC">
    Expose admin operations with your own `authMutation`/`authQuery` functions calling the `auth.connection.*` facade.
  </Card>
</CardGrid>

The `auth.connection.*` namespace is a server-side helper API. It is not
automatically exposed as client-callable Convex functions just because it
exists on the returned object.

If your app wants public group connection admin RPC, expose it explicitly by
writing `authMutation`/`authQuery` functions that authorize with
`auth.member.assert` and call the `auth.connection.*` facade — for example in
`convex/auth/group.ts`.

Use Convex-native args on those wrappers: `{ id }` for primary IDs,
`{ connectionId }` for foreign-key scoped operations, `{ data }` for
create/update payloads, and `paginationOpts` for unbounded lists.
