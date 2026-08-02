# Provider selection

Inspect the installed provider type before using optional fields. The examples
below show the stable shape at publication time.

## OAuth

```ts
import { github } from "@robelest/convex-auth/providers";
import { env } from "./_generated/server";

if (!env.AUTH_GITHUB_ID || !env.AUTH_GITHUB_SECRET) {
  throw new Error("GitHub OAuth environment variables are required");
}

github({
  clientId: env.AUTH_GITHUB_ID,
  clientSecret: env.AUTH_GITHUB_SECRET,
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
import { email, password } from "@robelest/convex-auth/providers";

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
import { passkey } from "@robelest/convex-auth/providers";

passkey();
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

## Other built-in providers

- `totp({ issuer })`: require an enrollment and recovery design.
- `anonymous()`: define upgrade/linking behavior before storing durable data.
- `email({ send })`: ensure links/codes bind to the intended flow and expire.
- `phone({ send })`: rate-limit both delivery and verification.
- `device({ verificationUri })`: verify the user-code approval and polling
  interval behavior.
- `connection()`: expose app-owned, authorized wrappers for group SSO
  administration; never publish the server facade directly.

Add only the provider requested by the product. A longer provider array is not
better authentication.
