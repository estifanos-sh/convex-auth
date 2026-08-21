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

`auth.connection.policy` defines what a normalized external identity is allowed
to change. It centralizes account linking, user creation, profile authority,
SCIM reuse, just-in-time membership, external group and role mapping, and
deprovisioning. Keeping these decisions in one policy prevents an OIDC or SAML
adapter from quietly inventing its own account lifecycle.

## Methods

| Method     | Signature                   | Returns                 | Description                                                                   |
| ---------- | --------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `get`      | `(ctx, { groupId })`        | `GroupConnectionPolicy` | Returns the canonical policy for a group.                                     |
| `update`   | `(ctx, { groupId, patch })` | `GroupConnectionPolicy` | Applies a partial update and returns the new policy.                          |
| `validate` | `(ctx, { groupId })`        | `{ checks: [...] }`     | Validates the policy document for a group. Each check has its own `ok` field. |

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

Policy owns decisions made after a provider has proved and normalized an
identity. It answers whether the identity may link to an existing account,
whether a missing user or membership may be created, which source may update a
profile, how external groups map to role IDs, and what happens when the external
directory disables a user.

Allowed authentication methods, domain restrictions, and session or token
lifetimes are not first-class connection policy fields. They belong to provider,
domain-trust, and session configuration respectively. Keeping those boundaries
explicit prevents one policy document from becoming an untyped collection of
unrelated security switches.

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
