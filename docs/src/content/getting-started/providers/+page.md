---
title: Providers
description: Auth methods available in convex-auth.
---

<svelte:head>

  <title>Providers - convex-auth</title>
</svelte:head>

# Providers

## OAuth

convex-auth currently ships first-party OAuth wrappers for Google, GitHub,
Apple, and Microsoft. Each wrapper owns the provider defaults and automatically
derives the callback URL from `CONVEX_SITE_URL` unless you override it.
These examples use application-owned environment names. Declare the values in
your own `defineApp({ env: { ...authEnv, ... } })` definition and import the
generated `env` from `./_generated/server`. Convex Auth does not read or reserve
provider credential names.

```ts
import { defineAuth } from "@estifanos-sh/convex-auth/server";
import {
  anonymous,
  apple,
  credentials,
  custom,
  email,
  github,
  google,
  microsoft,
  webauthn,
  password,
  phone,
  connection,
  totp,
} from "@estifanos-sh/convex-auth/providers";
import { components } from "./_generated/api";
import { env } from "./_generated/server";

defineAuth(components.auth, {
  providers: [
    github({
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    }),
    google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }),
    microsoft({
      tenant: env.MICROSOFT_TENANT_ID,
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET!,
    }),
  ],
});
```

GitHub includes a built-in profile fetch. Google, Apple, and Microsoft rely on
their ID token claims by default.

### Profile sync on re-auth

OAuth providers default to `updateProfileOnLogin: true` — on a returning
sign-in for the same `(provider, providerAccountId)`, the user's `name`,
`image`, and `email` are refreshed from the new provider profile. This
matches Auth.js / Clerk conventions.

Opt out per-provider if your app owns the canonical user profile:

```ts
google({
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
  updateProfileOnLogin: false, // keep user fields user-edited
});
```

The flag is available on `google`, `github`, `apple`, `microsoft`, and
`custom`. SSO connections have their own equivalent under
`policy.provisioning.user.updateProfileOnLogin`.

### Google

- Import: `@estifanos-sh/convex-auth/providers`
- Factory:
  `google({ clientId, clientSecret, redirectUri?, scopes?, accountLinking?, updateProfileOnLogin? })`
- Default scopes: `openid profile email`
- Example app env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

```ts
import { google } from "@estifanos-sh/convex-auth/providers";

defineAuth(components.auth, {
  providers: [
    google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }),
  ],
});
```

Use `redirectUri` only when you need to override the default callback route.

### GitHub

- Import: `@estifanos-sh/convex-auth/providers`
- Factory:
  `github({ clientId, clientSecret, redirectUri?, scopes?, accountLinking?, updateProfileOnLogin? })`
- Default scopes: `user:email`
- Example app env: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

```ts
import { github } from "@estifanos-sh/convex-auth/providers";

defineAuth(components.auth, {
  providers: [
    github({
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    }),
  ],
});
```

The GitHub wrapper performs the profile and email fetch for you.

### Apple

- Import: `@estifanos-sh/convex-auth/providers`
- Factory:
  `apple({ clientId, teamId, keyId, privateKey, redirectUri?, scopes?, accountLinking?, updateProfileOnLogin? })`
- Default scopes: `name email`
- Example app env: `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
  `APPLE_PRIVATE_KEY`

```ts
import { apple } from "@estifanos-sh/convex-auth/providers";

defineAuth(components.auth, {
  providers: [
    apple({
      clientId: env.APPLE_CLIENT_ID,
      teamId: env.APPLE_TEAM_ID,
      keyId: env.APPLE_KEY_ID,
      privateKey: env.APPLE_PRIVATE_KEY,
    }),
  ],
});
```

Apple may only return name data during the initial consent flow, so plan to
persist any extra profile fields you care about on first sign-in.

### Microsoft

- Import: `@estifanos-sh/convex-auth/providers`
- Factory:
  `microsoft({ tenant, clientId, clientSecret?, redirectUri?, scopes?, accountLinking?, updateProfileOnLogin? })`
- Default scopes: `openid profile email`
- Example app env: `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, and optionally
  `MICROSOFT_CLIENT_SECRET`

```ts
import { microsoft } from "@estifanos-sh/convex-auth/providers";

defineAuth(components.auth, {
  providers: [
    microsoft({
      tenant: env.MICROSOFT_TENANT_ID,
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET!,
    }),
  ],
});
```

The Microsoft wrapper validates the ID token and nonce internally.

### OAuth imports

- `@estifanos-sh/convex-auth/providers`

## Custom OAuth

```ts
defineAuth(components.auth, {
  providers: [
    custom({
      id: "discord",
      clientId: env.AUTH_DISCORD_ID!,
      clientSecret: env.AUTH_DISCORD_SECRET!,
      scopes: ["identify", "email"],
      authorization: {
        url: "https://discord.com/oauth2/authorize",
        pkce: "optional",
      },
      token: {
        url: "https://discord.com/api/oauth2/token",
        authMethod: "body",
      },
      profile: async ({ accessToken }) => {
        const res = await fetch("https://discord.com/api/users/@me", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const user = await res.json();
        return {
          id: String(user.id),
          email: user.email,
          name: user.username,
        };
      },
    }),
  ],
});
```

Use `custom()` when the provider is OAuth-based but does not have a first-party
wrapper yet. The `profile()` callback receives a stable token object owned by
convex-auth so the public API does not depend on Arctic.

## Custom Credentials

`credentials()` is the low-level escape hatch for authentication that is not
OAuth-based. Provide an `authorize` callback that validates the submitted
credentials and returns the authenticated user; return `null` to reject the
attempt. The built-in `password()` provider is layered on top of this.

- Import: `@estifanos-sh/convex-auth/providers`
- Factory: `credentials({ id?, authorize, crypto?, extraProviders? })`
- Default `id`: `"credentials"`

```ts
import { credentials } from "@estifanos-sh/convex-auth/providers";

defineAuth(components.auth, {
  providers: [
    credentials({
      id: "api-token",
      authorize: async (params, ctx) => {
        const user = await lookupUserByToken(ctx, params.token as string);
        return user ? { userId: user._id } : null;
      },
    }),
  ],
});
```

`authorize` receives the raw `params` passed to `signIn` and the action `ctx`.
Return `{ userId }` (optionally `sessionId`) to complete sign-in, a deferred
`SignInFlowResult` for multi-step flows, or `null` to reject. Pass `crypto`
(`hashSecret`/`verifySecret`) for password-style secret verification, and
`extraProviders` to register additional providers alongside it.

## Password

```ts
defineAuth(components.auth, {
  providers: [password()],
});
```

The password provider supports six flows, all single-word camelCase. Pass the
flow in the second argument to `signIn`:

| Flow      | Authenticated? | Required params                           | Notes                                                  |
| --------- | -------------- | ----------------------------------------- | ------------------------------------------------------ |
| `signUp`  | No             | `email`, `password`                       | Creates a new account                                  |
| `signIn`  | No             | `email`, `password`                       | Authenticate existing user                             |
| `reset`   | No             | `email`                                   | Sends an OTP through the configured reset provider     |
| `verify`  | No             | `email`, `code`                           | Verifies a post-signup email OTP                       |
| `recover` | No             | `email`, `code`, `newPassword`            | Verifies a reset OTP and completes configured recovery |
| `change`  | Yes            | `email`, `currentPassword`, `newPassword` | Authenticated change. Other sessions invalidated       |

`reset` and `recover` require a `reset` email provider; `verify` requires a
`verify` email provider. The OTP scope is enforced server-side, so reset and
signup verification codes cannot be exchanged across flows.

```ts
// Forgot password
await auth.signIn("password", { email, flow: "reset" });
await auth.signIn("password", { email, code, newPassword, flow: "recover" });

// Change password (authenticated)
await auth.signIn("password", { email, currentPassword, newPassword, flow: "change" });
```

To enable `reset` and post-signup email verification, pass an email provider:

```ts
import { password, email } from "@estifanos-sh/convex-auth/providers";

const emailProvider = email({ from: "noreply@example.com", send: ... });

password({ reset: emailProvider, verify: emailProvider });
```

To require a replacement passkey during account recovery, reuse the configured
WebAuthn provider and pass its typed rotation operation to `afterReset`:

```ts
import { password, webauthn } from "@estifanos-sh/convex-auth/providers";

const passkeys = webauthn();

defineAuth(components.auth, {
  providers: [
    password({
      reset: emailProvider,
      afterReset: passkeys.rotate(),
    }),
    passkeys,
  ],
});
```

After the reset OTP is verified, the browser automatically registers the new
passkey. The new password remains staged until registration succeeds. That
single completion transaction replaces the user's passkeys, revokes prior
sessions, commits the password, and issues the final session. No restricted or
normal session exists between OTP verification and passkey registration.

## Magic Links (Email)

```ts
defineAuth(components.auth, {
  providers: [
    email({
      from: "My App <noreply@example.com>",
      send: async (ctx, { from, to, subject, html }) => {
        const resend = new Resend(env.RESEND_API_KEY);
        await resend.emails.send({ from, to, subject, html });
      },
    }),
  ],
});
```

## WebAuthn

```ts
defineAuth(components.auth, {
  providers: [webauthn()],
});
```

Configure registration and authentication ceremonies independently. This
profile guides supporting browsers toward roaming security keys, but does not
enforce a hardware manufacturer:

```ts
import { webauthn } from "@estifanos-sh/convex-auth/providers";

defineAuth(components.auth, {
  providers: [
    webauthn({
      rpName: "Staff access",
      registration: {
        authenticatorAttachment: "cross-platform",
        residentKey: "discouraged",
        userVerification: "required",
        hints: ["security-key"],
      },
      authentication: {
        userVerification: "required",
        hints: ["security-key"],
      },
    }),
  ],
});
```

Use `client.webauthn.register()` and `client.webauthn.signIn()` to run the
ceremonies. For this security-key-oriented profile, pass the account email so
the server can select that account's credentials:

```ts
await client.webauthn.signIn({ email });
```

Each user can register up to 16 WebAuthn credentials. Email-first sign-in pads
the credential list with secret-derived decoys, but credential IDs are
authenticator-generated and variable-length. Treat that padding as defense in
depth, not a guarantee against account enumeration. If identifier privacy is a
hard requirement, use discoverable credentials and call
`client.webauthn.signIn()` without an identifier.

Sign-in without an identifier and conditional UI (`{ autofill: true }`) require
discoverable credentials. Existing passkey credentials remain valid when ceremony
preferences change.

WebAuthn hints are non-binding browser guidance. To reject password managers,
synced passkeys, and other credentials without trusted manufacturer evidence,
add the FIDO Metadata Service policy inside `registration`:

```ts
import { webauthn } from "@estifanos-sh/convex-auth/providers";

defineAuth(components.auth, {
  providers: [
    webauthn({
      registration: {
        authenticatorAttachment: "cross-platform",
        residentKey: "discouraged",
        userVerification: "required",
        hints: ["security-key"],
        attestation: webauthn.attestation.fidoMds({
          allowedAaguids: ["2fc0579f-8113-47ea-b116-bb5a8db9202a"],
        }),
      },
      authentication: {
        userVerification: "required",
        hints: ["security-key"],
      },
    }),
  ],
});
```

Omit `allowedAaguids` to accept any authenticator with full manufacturer
attestation that is currently trusted by FIDO MDS. Provide it to restrict
registration to specific models. The AAGUID allow list is applied only after
the attestation signature and manufacturer certificate chain are verified.

Strict attestation is fail-closed. Registration requests direct attestation and
rejects missing, self, anonymous, unknown, revoked, compromised, or disallowed
authenticators. Each sign-in re-checks the current MDS status and allow list.
Credentials registered before the policy was enabled have no trusted evidence
and must be registered again.

## TOTP (Authenticator Apps)

```ts
defineAuth(components.auth, {
  providers: [totp({ issuer: "My App" })],
});
```

## Anonymous

```ts
defineAuth(components.auth, {
  providers: [anonymous()],
});
```

## Phone / SMS

```ts
defineAuth(components.auth, {
  providers: [
    phone({
      send: async ({ identifier, token }) => {
        // send SMS via Twilio, etc.
      },
    }),
  ],
});
```

## Group SSO

```ts
defineAuth(components.auth, {
  providers: [connection()],
});
```

Adding `connection()` enables the `auth.connection.*` namespace and registers OIDC,
SAML, and SCIM HTTP routes. See the [SSO overview](/connection/overview/) for details.
