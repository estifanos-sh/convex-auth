---
title: Providers
description: Auth methods available in convex-auth.
---

A provider is an authentication method inside Convex Auth. It proves an
identity, then hands control back to the shared account and session system. It
should not create application-owned users or sessions, and application code
should not need to know which provider authenticated the current user.

Start with a built-in provider whenever one matches the protocol you need. The
built-in providers own credential storage, verification, rate limiting, account
linking, session issuance, and multi-step ceremonies as one system. Configure
them in `defineAuth`; do not reproduce those responsibilities in app tables or
callbacks.

## OAuth

convex-auth currently ships first-party OAuth wrappers for Google, GitHub,
Apple, and Microsoft. Each wrapper owns the provider defaults and automatically
derives the callback URL from `CONVEX_SITE_URL` unless you override it.
These examples use application-owned environment names. Declare the values in
your own `defineApp({ env: { ... } })` definition and import the generated
`env` from `./_generated/server`. Convex Auth does not read or reserve provider
credential names.

```ts
import { defineAuth } from "@estifanos-sh/convex-auth/server";
import { anonymous } from "@estifanos-sh/convex-auth/providers/anonymous";
import { apple } from "@estifanos-sh/convex-auth/providers/apple";
import { connection } from "@estifanos-sh/convex-auth/providers/connection";
import { credentials } from "@estifanos-sh/convex-auth/providers/credentials";
import { custom } from "@estifanos-sh/convex-auth/providers/custom";
import { email } from "@estifanos-sh/convex-auth/providers/email";
import { github } from "@estifanos-sh/convex-auth/providers/github";
import { google } from "@estifanos-sh/convex-auth/providers/google";
import { microsoft } from "@estifanos-sh/convex-auth/providers/microsoft";
import { password } from "@estifanos-sh/convex-auth/providers/password";
import { phone } from "@estifanos-sh/convex-auth/providers/phone";
import { totp } from "@estifanos-sh/convex-auth/providers/totp";
import { webauthn } from "@estifanos-sh/convex-auth/providers/webauthn";
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
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
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

Import `google` from `@estifanos-sh/convex-auth/providers` and pass the client
ID and secret chosen by your application. The provider requests
`openid profile email` by default. Override the redirect URI, scopes, account
linking, or profile synchronization only when the provider registration or your
identity policy requires different behavior.

```ts
import { google } from "@estifanos-sh/convex-auth/providers/google";

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

Import `github` from `@estifanos-sh/convex-auth/providers` and provide the
application's client ID and secret. It requests `user:email` and performs the
profile and email fetch required to normalize GitHub identity into a Convex Auth
user.

```ts
import { github } from "@estifanos-sh/convex-auth/providers/github";

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

Apple requires the service client ID, team ID, key ID, and private key owned by
your application. The provider requests `name email` by default. Apple may
return a person's name only during initial consent, which is why Convex Auth
persists the normalized profile instead of requiring application code to
reconstruct it on later sign-ins.

```ts
import { apple } from "@estifanos-sh/convex-auth/providers/apple";

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

Microsoft configuration starts with the tenant and client ID; confidential
clients also pass their secret. The default `openid profile email` scopes allow
the provider to validate the ID token and normalize its claims. Keep the tenant
choice explicit because it determines which Microsoft directory may establish
an identity.

```ts
import { microsoft } from "@estifanos-sh/convex-auth/providers/microsoft";

defineAuth(components.auth, {
  providers: [
    microsoft({
      tenant: env.MICROSOFT_TENANT_ID,
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
    }),
  ],
});
```

The Microsoft wrapper validates the ID token and nonce internally.

### OAuth imports

`@estifanos-sh/convex-auth/providers`.

## Custom OAuth

```ts
defineAuth(components.auth, {
  providers: [
    custom({
      id: "discord",
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
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

`credentials()` is the application-specific entry point for a non-OAuth proof,
not a license to build another auth system. Its Convex validator is used three
times: it rejects invalid requests at the action boundary, types the
`authorize` callback, and becomes the exact parameter type of
`authClient.signIn(provider, params)`. The generated `api.auth` reference carries
that contract to the browser, so no `InferClientApi`, handwritten client
interface, or assertion is necessary.

```ts
import { v } from "convex/values";
import { credentials } from "@estifanos-sh/convex-auth/providers/credentials";

defineAuth(components.auth, {
  providers: [
    credentials({
      id: "api-token",
      params: v.object({ token: v.string() }),
      authorize: async (params, ctx) => {
        const user = await lookupUserByToken(ctx, params.token);
        return user ? { userId: user._id } : null;
      },
    }),
  ],
});
```

`authorize` receives validated parameters and the action `ctx`. Return
`{ userId }` (optionally `sessionId`) to complete sign-in, or `null` to reject.
Pass `crypto` (`hashSecret`/`verifySecret`) for password-style secret
verification, and `extraProviders` to register additional providers alongside
it.

### Continue one proof into another

When one credential is only the first part of authentication, return the next
provider's operation instead of returning a user or session. Convex Auth stores
the authorization ticket, binds it to the verified user and operation, and
issues the session only after the second ceremony succeeds.

The following pattern covers an invitation that enrolls a PIN and replacement
security key, followed by normal PIN-plus-key sign-in. The application verifies
the invitation because invitations are product policy. Convex Auth owns the PIN
account, its hashing and attempt limits, the passkey continuation, rotation,
session revocation, and final session.

```ts
import { v } from "convex/values";
import { credentials } from "@estifanos-sh/convex-auth/providers/credentials";
import { password } from "@estifanos-sh/convex-auth/providers/password";
import { webauthn } from "@estifanos-sh/convex-auth/providers/webauthn";

const passkeys = webauthn({ securityKeysOnly: true });
const pin = password({
  id: "pin",
  validatePasswordRequirements: validatePin,
  crypto: { hashSecret: hashPin, verifySecret: verifyPin },
});

const access = credentials({
  id: "access",
  params: v.union(
    v.object({
      operation: v.literal("enroll"),
      invite: v.string(),
      pin: v.string(),
    }),
    v.object({
      operation: v.literal("signIn"),
      email: v.string(),
      pin: v.string(),
    }),
  ),
  authorize: async (params, ctx) => {
    if (params.operation === "enroll") {
      const invited = await verifyApplicationInvite(ctx, params.invite);
      return await ctx.auth.credentials.provision(ctx, {
        verifier: pin,
        account: { id: invited.email, secret: params.pin },
        profile: {
          email: invited.email,
          emailVerified: true,
          name: invited.name,
        },
        match: ["email"],
        operation: passkeys.rotate(),
      });
    }

    return await ctx.auth.credentials.verify(ctx, {
      verifier: pin,
      account: { id: params.email, secret: params.pin },
      operation: passkeys.signIn(),
    });
  },
  extraProviders: [pin, passkeys],
});

defineAuth(components.auth, { providers: [access] });
```

`credentials.provision` first stages only the provider-hashed credential and
verified profile. It does not create a user, account, or session while the
passkey ceremony is pending. Successful registration materializes or safely
links the auth user, stores both credentials, revokes prior passkeys and
sessions, and issues the final session in one mutation transaction.
`credentials.verify` applies the configured provider's verification and
attempt limiting before starting a user-bound passkey assertion.
`passkeys.rotate()` and `passkeys.signIn()` are the operation vocabulary;
callers do not invent `flow`, `mode`, or `purpose` strings for continuation
behavior.

The browser call stays ordinary and fully inferred:

```ts
await authClient.signIn("access", {
  operation: "signIn",
  email,
  pin,
});
```

Do not call `components.auth.*` from `authorize`, return a temporary session,
or store a recovery transaction in the application schema. Those approaches
split one revocation boundary into several systems and are precisely what the
credential continuation owns.

See [`auth.provider`](/api/provider) for the lower-level trusted server
composition methods and when to use them instead of the credential helpers.

## Password

```ts
defineAuth(components.auth, {
  providers: [password()],
});
```

The password provider owns account creation, sign-in, verification, recovery,
and authenticated password changes. Use `signUp` with `email` and `password`
to create an account, or `signIn` with the same fields for an existing account.
`reset` sends a recovery code; `recover` accepts that code with `newPassword`.
`verify` accepts the post-signup verification code, while `change` requires the
current authenticated user, `currentPassword`, and `newPassword`, then
invalidates the user's other sessions.

`reset` and `recover` require a configured reset email provider, and `verify`
requires a verification email provider. Codes are scoped to their operation,
so a signup verification code cannot be exchanged for password recovery.

```ts
// Forgot password
await auth.signIn("password", { email, flow: "reset" });
await auth.signIn("password", { email, code, newPassword, flow: "recover" });

// Change password (authenticated)
await auth.signIn("password", { email, currentPassword, newPassword, flow: "change" });
```

To enable `reset` and post-signup email verification, pass an email provider:

```ts
import { email } from "@estifanos-sh/convex-auth/providers/email";
import { password } from "@estifanos-sh/convex-auth/providers/password";

const emailProvider = email({ from: "noreply@example.com", send: ... });

password({ reset: emailProvider, verify: emailProvider });
```

To require a replacement passkey during account recovery, reuse the configured
WebAuthn provider and pass its typed rotation operation to `afterReset`:

```ts
import { password } from "@estifanos-sh/convex-auth/providers/password";
import { webauthn } from "@estifanos-sh/convex-auth/providers/webauthn";

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

Recovery consumes the OTP and creates its rotation continuation in one
transaction. A retry cannot reuse that OTP, and a second valid reset cannot
replace an already pending rotation. If the browser ceremony expires or is
abandoned, the staged password is never applied; start recovery again with a
new reset email.

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
import { webauthn } from "@estifanos-sh/convex-auth/providers/webauthn";

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
import { webauthn } from "@estifanos-sh/convex-auth/providers/webauthn";

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
