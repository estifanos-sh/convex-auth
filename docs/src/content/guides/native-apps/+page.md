---
title: Native apps (iOS + Android)
description: Set up native passkeys, Associated Domains, and App Links for Expo / React Native.
---

<svelte:head>

  <title>Native apps - convex-auth</title>
</svelte:head>

# Native apps (iOS + Android)

Native passkeys on iOS and Android only work when the app declares an
**Associated Domain** (iOS) or **App Link** (Android) for your WebAuthn RP
ID, and that domain serves the matching `.well-known` files. This guide
walks through both sides for an Expo app paired with a SvelteKit (or any
other) frontend.

## What you'll wire up

| Side       | What                                                        |
| ---------- | ----------------------------------------------------------- |
| Native app | Expo auth client + iOS Associated Domains + Android intents |
| App origin | `apple-app-site-association` + `assetlinks.json`            |

## Use the Expo client

Import the client from `@estifanos-sh/convex-auth/expo` in native apps. This
entrypoint uses Expo-native defaults: SecureStore token persistence,
`expo-auth-session` OAuth launching, and native passkey support.

```tsx
import { api } from "../convex/_generated/api";
import { client } from "@estifanos-sh/convex-auth/expo";

import { convex } from "./convex";

export const auth = client({
  convex,
  api: api.auth,
  authSession: {
    scheme: "myapp",
    redirectUri: "myapp://auth",
  },
});
```

Do not use `@estifanos-sh/convex-auth/browser` in native Expo code. The Expo
entrypoint falls back to the browser client automatically when running on web.

## iOS

### 1. Get your Team ID and Bundle ID

**Team ID**: Apple Developer → Membership → Team ID (10-character string); **Bundle ID**: From `app.config.ts` / `app.json` → `ios.bundleIdentifier`. Combined as `TEAMID.com.example.app`.

### 2. Add the Associated Domain to your Expo config

```ts
// app.config.ts
const passkeyDomain = process.env.APP_URL ? new URL(process.env.APP_URL).hostname : null;

module.exports = {
  expo: {
    ios: {
      bundleIdentifier: "com.example.app",
      ...(passkeyDomain ? { associatedDomains: [`webcredentials:${passkeyDomain}`] } : {}),
    },
  },
};
```

For local development, append `?mode=developer` to bypass AASA verification
(iOS 17.4+):

```ts
associatedDomains: [`webcredentials:${passkeyDomain}?mode=developer`],
```

### 3. Serve AASA from the app origin

Set `IOS_APP_IDS` on the Convex deployment or on the frontend/edge host that
serves `/.well-known/*`:

```bash
IOS_APP_IDS="ABC123DEF.com.example.app"
```

`auth.http()` serves the route automatically from Convex. If your frontend owns
the app origin, proxy `/.well-known/apple-app-site-association` to Convex or
adapt the same helper in your framework route:

```ts
// src/routes/.well-known/apple-app-site-association/+server.ts
import { wellKnown } from "@estifanos-sh/convex-auth/server";

export const GET = () => {
  const r = wellKnown("apple-app-site-association");
  if (r === null) return new Response(null, { status: 404 });
  return new Response(r.body, { status: r.status, headers: r.headers });
};
```

### 4. Rebuild and verify

```bash
pnpm expo prebuild --clean
pnpm expo run:ios --device
```

Verify Apple's CDN sees the file:

```bash
curl https://app-site-association.cdn-apple.com/a/v1/<your-domain>
```

In iOS Settings, search for your app — Associated Domains should list your
host. Pressing the passkey button should now show the native iOS sheet.

## Android

### 1. Get your SHA-256 fingerprint

For debug builds:

```bash
cd android && ./gradlew signingReport
```

For release builds, use the fingerprint from Google Play Console → Setup →
App signing.

### 2. Add intent filters to Expo config

```ts
// app.config.ts
module.exports = {
  expo: {
    android: {
      package: "com.example.app",
      ...(passkeyDomain
        ? {
            intentFilters: [
              {
                action: "VIEW",
                autoVerify: true,
                data: [{ scheme: "https", host: passkeyDomain }],
                category: ["BROWSABLE", "DEFAULT"],
              },
            ],
          }
        : {}),
    },
  },
};
```

### 3. Serve `assetlinks.json` from the app origin

Set `ANDROID_APP_LINKS`:

```bash
ANDROID_APP_LINKS="com.example.app:AA:BB:CC:DD:EE:FF:..."
```

`auth.http()` serves the route automatically from Convex. If your frontend owns
the app origin, proxy `/.well-known/assetlinks.json` to Convex or adapt the
same helper in your framework route:

```ts
// src/routes/.well-known/assetlinks.json/+server.ts
import { wellKnown } from "@estifanos-sh/convex-auth/server";

export const GET = () => {
  const r = wellKnown("assetlinks.json");
  if (r === null) return new Response(null, { status: 404 });
  return new Response(r.body, { status: r.status, headers: r.headers });
};
```

### 4. Verify

Use Google's validator:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://<host>&relation=delegate_permission/common.get_login_creds
```

Trigger Credential Manager from a real Android device — the passkey sheet
should appear.

## Choosing the RP ID

Your WebAuthn RP ID must match the AASA / `assetlinks.json` host. The
The convex-auth `webauthn()` provider derives the RP ID from `APP_URL` by
default:

| `APP_URL`                 | RP ID             |
| ------------------------- | ----------------- |
| `https://app.example.com` | `app.example.com` |
| `http://localhost:5173`   | `localhost`       |

You can override with `webauthn({ rpId: "example.com" })` if you want passkeys
to work across subdomains (the AASA / `assetlinks.json` must then live at
`example.com`).

## Troubleshooting

When the native sheet does not appear, first verify the Associated Domain
entitlement and fetch Apple's cached AASA response from
`https://app-site-association.cdn-apple.com/a/v1/<host>`. A “webauthn not
supported” result should be checked with `Passkey.isSupported()`; native
passkeys require iOS 16 or Android 14 with suitable Play Services. Counter
validation failures on an emulator should be reproduced on a physical device,
because emulator Credential Manager behavior is incomplete.

## Related

The [.well-known reference](/reference/well-known) explains the association
documents. Use the [production guide](/guides/production) to verify them on the
deployed host.
