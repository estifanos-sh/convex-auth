---
title: .well-known endpoints
description: Standard discovery endpoints for OIDC, native passkeys, password managers, and security disclosure.
---

<svelte:head>

  <title>.well-known endpoints - convex-auth</title>
</svelte:head>

# `.well-known` endpoints

A comprehensive cross-platform auth experience needs several `.well-known`
endpoints. `auth.http()` serves the auth protocol endpoints on Convex, including
the app-discovery endpoints under root `/.well-known/*`.

For Apple, Android, WebAuthn related origins, password managers, and
`security.txt`, standards clients discover files on the public app origin. If
your WebAuthn relying-party (RP) ID is `app.example.com`, make
`https://app.example.com/.well-known/*` reach these Convex HTTP routes by using
a Convex custom domain or a frontend/edge proxy.

## At a glance

| Endpoint                                  | Hosted on               | Required for                           |
| ----------------------------------------- | ----------------------- | -------------------------------------- |
| `/auth/.well-known/openid-configuration`  | Convex auth prefix      | OIDC discovery (consumers of JWTs)     |
| `/auth/.well-known/jwks.json`             | Convex auth prefix      | JWT verification                       |
| `/.well-known/apple-app-site-association` | Public app/RP ID origin | Native iOS passkeys + Universal Links  |
| `/.well-known/assetlinks.json`            | Public app/RP ID origin | Native Android passkeys + App Links    |
| `/.well-known/webauthn`                   | Public app/RP ID origin | Multi-origin passkeys                  |
| `/.well-known/change-password`            | Public app origin       | Password manager deep-links            |
| `/.well-known/security.txt`               | Public app origin       | Security researcher contact (RFC 9116) |

The OIDC and JWKS endpoints are served under the same prefix as `auth.http()`,
which defaults to `/auth`. The other endpoints are root `.well-known` routes
because platform clients look there.

## Auto-mounted routes

These ship with the library:

```bash
curl https://<your-convex-site>/auth/.well-known/openid-configuration
curl https://<your-convex-site>/auth/.well-known/jwks.json
curl https://<your-convex-site>/.well-known/apple-app-site-association
curl https://<your-convex-site>/.well-known/assetlinks.json
curl https://<your-convex-site>/.well-known/webauthn
curl https://<your-convex-site>/.well-known/change-password
curl https://<your-convex-site>/.well-known/security.txt
```

Most root routes return `404` until their environment variables are configured.

## Framework adapters

Use the single `wellKnown` helper when a frontend framework or edge worker owns
the app origin and needs to serve or proxy root `/.well-known/*` itself.

### iOS — `apple-app-site-association`

```ts
// SvelteKit: src/routes/.well-known/apple-app-site-association/+server.ts
import { wellKnown } from "@estifanos-sh/convex-auth/server";

export const GET = () => {
  const r = wellKnown("apple-app-site-association");
  if (r === null) return new Response(null, { status: 404 });
  return new Response(r.body, { status: r.status, headers: r.headers });
};
```

Configure with `IOS_APP_IDS` (comma-separated `TEAMID.bundle.id` entries)
and optional `IOS_APPLINK_PATHS` (comma-separated path patterns, defaults to
`/auth/*,/callback/*`).

> ⚠️ The path has **no `.json` extension**. Apple's CDN fetches it without
> one. Do not redirect — Apple will not follow redirects for this file.

### Android — `assetlinks.json`

```ts
import { wellKnown } from "@estifanos-sh/convex-auth/server";

const r = wellKnown("assetlinks.json");
```

Configure with `ANDROID_APP_LINKS` in the format
`package1:FP1;package2:FP2` where each fingerprint is a colon-separated
SHA-256 hex string. Find your fingerprint with `gradlew signingReport` (debug)
or in the Play Console (release).

The output is a top-level JSON array (not an object) — that's the spec.

### Passkeys — `webauthn`

```ts
import { wellKnown } from "@estifanos-sh/convex-auth/server";

const r = wellKnown("webauthn");
```

This returns the single frontend origin from `APP_URL`. That is the happy path
for a single app origin and avoids extra deployment configuration.

### Password managers — `change-password`

```ts
import { wellKnown } from "@estifanos-sh/convex-auth/server";

const r = wellKnown("change-password", {
  changePassword: { targetUrl: "https://app.example.com/settings/password" },
});
```

Configure with `CHANGE_PASSWORD_URL` (the in-app settings page URL).
Returns a 302 redirect — supported by 1Password, iCloud Keychain, Bitwarden,
and Chrome's built-in password manager.

The settings page should call the password provider's `change` flow:

```ts
await auth.signIn("password", {
  email,
  currentPassword,
  newPassword,
  flow: "change",
});
```

See [Password provider](/getting-started/providers#password) for details.

### Security researchers — `security.txt`

```ts
import { wellKnown } from "@estifanos-sh/convex-auth/server";

const r = wellKnown("security.txt");
```

Configure with `SECURITY_CONTACT` (e.g., `mailto:security@example.com` or
`https://example.com/security`). Optional: `SECURITY_TXT_EXPIRES_DAYS`
(default 365).

## Common pitfalls

Apple's association file must be served directly, without a redirect and
without a `.json` extension. The exact path is
`/.well-known/apple-app-site-association`. Apple caches it aggressively; during
development on iOS 17.4 or newer, the Associated Domain entitlement can append
`?mode=developer` to bypass the normal cache and verification behavior.

The WebAuthn relying-party ID and association host must agree. An RP ID of
`app.example.com` requires the file at
`https://app.example.com/.well-known/apple-app-site-association`. A mismatch
prevents the operating system from associating the passkey with the native app.

Preserve the response formats produced by the helper. AASA and
`assetlinks.json` use `application/json`, while `security.txt` uses
`text/plain`. Android's `assetlinks.json` document is a top-level array, not an
object containing an array.

## Related

Continue with the [native apps guide](/guides/native-apps) for iOS and Android
passkeys, then use the [production guide](/guides/production) to verify the
public endpoints. The [environment guide](/getting-started/environment)
explains the values used to generate each response.
