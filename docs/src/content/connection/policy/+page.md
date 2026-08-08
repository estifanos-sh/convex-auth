---
title: auth.connection.policy
description: Group policy management — centralize account linking, SCIM reuse, JIT, and
  deprovision behavior.
---

<svelte:head>

  <title>auth.connection.policy - convex-auth</title>
</svelte:head>

# auth.connection.policy

The `auth.connection.policy` namespace manages group SSO behavior for a group.
Use it to configure how OIDC and SAML account linking works, how
SCIM-provisioned users are reused, whether JIT membership is created on sign-in,
and how deprovisioning behaves.

> This page documents the **server-side helper API**:
> [`auth.connection.policy.*`](/connection/policy/). Client-callable admin RPC like
> `api.auth.group.updatePolicy` only exists after you expose it yourself — write
> an `authMutation` that authorizes with `auth.member.assert` and forwards to
> this facade, the same pattern as the rest of your app.

Connector mechanics stay in [`auth.connection.oidc`](/connection/oidc/),
[`auth.connection.saml`](/connection/saml/), and [`auth.connection.scim`](/connection/scim/).

`auth.connection.policy` is where you define how normalized external identity is
applied to your app:

- account linking
- user creation and profile-update authority
- SCIM reuse
- JIT membership creation
- group and role sync policy
- deprovision behavior

## Methods

| Method     | Signature                  | Returns                 | Description                                                                   |
| ---------- | -------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `get`      | `(ctx, { groupId })`       | `GroupConnectionPolicy` | Returns the canonical policy for a group.                                     |
| `update`   | `(ctx, { groupId, data })` | `GroupConnectionPolicy` | Applies a partial update and returns the new policy.                          |
| `validate` | `(ctx, { groupId })`       | `{ checks: [...] }`     | Validates the policy document for a group. Each check has its own `ok` field. |

## Default policy

```ts
const policy = await auth.connection.policy.get(ctx, { groupId });

policy.identity.accountLinking.oidc; // "verifiedEmail"
policy.identity.accountLinking.saml; // "verifiedEmail"
policy.provisioning.user.createOnSignIn; // true
policy.provisioning.user.updateProfileOnLogin; // "missing"
policy.provisioning.user.updateProfileFromScim; // "always"
policy.provisioning.user.authority; // "app"
policy.provisioning.scimReuse.user; // "externalId"
policy.provisioning.jit.mode; // "createUserAndMembership"
policy.provisioning.jit.defaultRoleIds; // ["member"]
policy.provisioning.groups.mode; // "ignore"
policy.provisioning.roles.mode; // "ignore"
policy.provisioning.deprovision.mode; // "soft"
```

## Example

```ts
await auth.connection.policy.update(ctx, {
  groupId,
  patch: {
    identity: {
      accountLinking: {
        saml: "none",
      },
    },
    provisioning: {
      user: {
        updateProfileOnLogin: "always",
        authority: "sso",
      },
      jit: {
        mode: "createUser",
        defaultRoleIds: ["member"],
      },
      groups: {
        mode: "sync",
        mapping: {
          engineering: ["member"],
        },
      },
      roles: {
        mode: "map",
        mapping: {
          admin: ["owner"],
        },
      },
      deprovision: {
        mode: "hard",
      },
    },
  },
});
```

## What belongs here

- account linking behavior
- user profile authority and update behavior
- SCIM user reuse behavior
- JIT provisioning behavior
- group sync behavior
- role sync behavior
- deprovision behavior

Not first-class yet:

- allowed auth methods
- domain restrictions
- session or token policy

Connector settings such as OIDC issuer URLs, client secrets, SAML metadata, and
SCIM bearer tokens remain in their respective
[`auth.connection.oidc`](/connection/oidc/), [`auth.connection.saml`](/connection/saml/), and
[`auth.connection.scim`](/connection/scim/) configuration APIs.

`provisioning.groups` and `provisioning.roles` currently map external protocol
values into membership `roleIds`. They do not create or mirror nested app groups
automatically.

If you need app-specific tweaks after protocol extraction but before
provisioning, use top-level `sso.hooks` on `defineAuth(...)` rather than
overloading policy with transport-specific logic.
