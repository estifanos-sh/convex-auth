# Provider selection

Inspect the installed provider type before using optional fields. The examples
below show the stable shape at publication time.

## OAuth

```ts
import { github } from "@estifanos-sh/convex-auth/providers";
import { env } from "./_generated/server";

if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
  throw new Error("GitHub OAuth environment variables are required");
}

github({
  clientId: env.GITHUB_CLIENT_ID,
  clientSecret: env.GITHUB_CLIENT_SECRET,
});
```

Use the generated server environment and the provider's default callback URL.
Override `redirectUri` only when the deployment architecture requires it.
Configure the exact callback in the provider console and keep development,
preview, and production credentials separate.

First-party OAuth factories include `google`, `github`, `apple`, and
`microsoft`. Use `custom` for another OAuth provider and `credentials` only for
a genuinely non-OAuth authentication ceremony.

## Password and email

```ts
import { email, password } from "@estifanos-sh/convex-auth/providers";

const mail = email({
  from: "App <noreply@example.com>",
  send: async (ctx, message) => {
    // Deliver message using a server-side provider.
  },
});

password({ reset: mail, verify: mail });
```

Do not enable reset or verification without a working delivery function. Keep
responses enumeration-resistant and validate a reset and verification failure
case.

## Passkeys and WebAuthn

```ts
import { webauthn } from "@estifanos-sh/convex-auth/providers";

const passkeys = webauthn();
```

Use the installed package type and current WebAuthn docs for registration
policy. Treat these separately:

- `authenticatorAttachment` and WebAuthn `hints` influence browser UX;
- user verification and resident-key settings constrain ceremony properties;
- hardware provenance requires verified attestation and a trust policy;
- an AAGUID allowlist without certificate-chain verification is not hardware
  enforcement;
- credentials registered before trusted attestation was recorded cannot be
  retroactively treated as trusted.

Test with the intended browser, origin, and authenticator. A password-manager
prompt does not prove the server accepted an untrusted credential; complete the
ceremony and inspect the stored trust result.

## Credential continuations

When a PIN or application-specific proof must be followed by a passkey, keep
the entire handoff in Convex Auth. `ctx.auth.credentials.verify` checks an
existing credentials account before `passkeys.signIn()`, while
`ctx.auth.credentials.provision` creates or safely links an account before
`passkeys.rotate()`. Both return provider-owned continuation options and delay
session issuance until WebAuthn succeeds.

```ts
return await ctx.auth.credentials.verify(ctx, {
  verifier: pinProvider,
  account: { id: email, secret: pin },
  operation: passkeys.signIn(),
});
```

Do not call generated `components.auth.*` functions from a credentials
callback, issue a temporary session, or create application tables for auth
challenges, recovery, passkeys, or credential hashes. Application code may
verify its own domain proof, such as an invitation, then hand the verified
identity to `credentials.provision`.

## Other built-in providers

- `totp({ issuer })`: require an enrollment and recovery design.
- `anonymous()`: define upgrade/linking behavior before storing durable data.
- `email({ send })`: ensure links/codes bind to the intended flow and expire.
- `phone({ send })`: rate-limit both delivery and verification.
- `device({ verificationUri })`: verify the user-code approval and polling
  interval behavior.
- `connection()`: enables group-connection runtime routes and the trusted
  `auth.connection.*` facade. Expose only app-owned, authorized wrappers for
  administration; never publish that facade directly.

Add only the provider requested by the product. A longer provider array is not
better authentication.
