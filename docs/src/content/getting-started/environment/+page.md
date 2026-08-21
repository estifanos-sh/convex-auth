---
title: Environment Variables
description: Required and optional environment variables for convex-auth.
---

<svelte:head>

  <title>Environment Variables - convex-auth</title>
</svelte:head>

# Environment Variables

## Required

| Variable    | Purpose                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------- |
| `AUTH_KEYS` | Versioned keyring for JWT signing, verification, and encrypting stored auth secrets at rest |
| `APP_URL`   | Frontend URL for OAuth, email, device, and passkey defaults                                 |

These are set automatically by the CLI setup wizard.

`AUTH_KEYS` contains independent signing, secret-encryption, and WebAuthn
response-masking keys in one CLI-managed JSON value. Combining their
configuration does not reuse key material across cryptographic purposes. Treat
the whole value as a secret and do not edit it by hand.

## System (auto-provided by Convex)

| Variable          | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `CONVEX_SITE_URL` | HTTP actions URL. Used as JWT issuer and OAuth callback base. |

Your `convex/auth.config.ts` should trust this same value as the native Convex
JWT issuer:

```ts
import { env } from "./_generated/server";

export default {
  providers: [
    {
      domain: `${env.CONVEX_SITE_URL}/auth`,
      applicationID: "convex",
    },
  ],
};
```

## Application-owned environment

Provider credentials and delivery-service secrets are not part of `authEnv`.
Declare them in your app and pass them explicitly to the provider that consumes
them:

```ts
// convex/convex.config.ts
import { authEnv } from "@estifanos-sh/convex-auth/server";
import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    ...authEnv,
    GITHUB_CLIENT_ID: v.string(),
    GITHUB_CLIENT_SECRET: v.string(),
    RESEND_API_KEY: v.string(),
  },
});
```

```ts
github({
  clientId: env.GITHUB_CLIENT_ID,
  clientSecret: env.GITHUB_CLIENT_SECRET,
});
```

The names above are examples owned by the application. Convex Auth neither
reads nor reserves them. The same applies to sender addresses, SMS credentials,
and flags that select which providers an application configures.

## Optional

| Variable           | Purpose                                                          | Default   |
| ------------------ | ---------------------------------------------------------------- | --------- |
| `AUTH_LOG_LEVEL`   | `DEBUG` / `INFO` / `WARN` / `ERROR`                              | `INFO`    |
| `AUTH_LOG_SECRETS` | `"true"` logs secret values in full; otherwise they are redacted | `"false"` |

Configure session lifetimes explicitly on `defineAuth`:

```ts
defineAuth(components.auth, {
  providers,
  session: {
    totalDurationMs: 30 * 24 * 60 * 60 * 1000,
    inactiveDurationMs: 7 * 24 * 60 * 60 * 1000,
  },
});
```

### `.well-known` content

These drive the [.well-known endpoints](/reference/well-known) — leave them
unset to disable a given endpoint (it then returns 404).

| Variable                    | Purpose                                                             | Default               |
| --------------------------- | ------------------------------------------------------------------- | --------------------- |
| `IOS_APP_IDS`               | Comma-separated `TEAMID.bundle.id` for `apple-app-site-association` | -                     |
| `IOS_APPLINK_PATHS`         | Comma-separated path patterns for `applinks` (e.g., `/auth/*`)      | `/auth/*,/callback/*` |
| `ANDROID_APP_LINKS`         | `package:FP1;package2:FP2` for `assetlinks.json`                    | -                     |
| `APP_URL`                   | Origin emitted by `/.well-known/webauthn`                           | -                     |
| `CHANGE_PASSWORD_URL`       | Redirect target for `/.well-known/change-password`                  | -                     |
| `SECURITY_CONTACT`          | `Contact:` for `security.txt` (`mailto:` or `https:`)               | -                     |
| `SECURITY_TXT_EXPIRES_DAYS` | Days until `Expires:` in `security.txt`                             | 365                   |

`APP_URL` is the canonical frontend URL used for generated links and default
redirects:

```bash
APP_URL=https://app.example.com
```
