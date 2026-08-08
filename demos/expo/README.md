# convex-auth Expo demo

The native companion to the
[convex-auth web demo](https://estifanos.sh/convex-auth/demo/). It exercises
the Expo client, OAuth redirects, secure token storage, and native WebAuthn
ceremonies against the repository's root Convex deployment.

## Work locally

Run commands from the repository root:

```bash
vp install
vp run dev:expo
```

The Convex development process is managed separately. You need a development
build for native WebAuthn; Expo Go does not include the required native module.

## Native WebAuthn

The relying-party host must serve Apple's AASA file and Android's
`assetlinks.json`. Set these variables on that host:

```bash
IOS_APP_IDS="ABC123DEF.com.example.app"
ANDROID_APP_LINKS="com.example.app:AA:BB:CC:DD:..."
SITE_URL="https://your-domain.example"
```

`SITE_URL` must use the same host as the WebAuthn RP ID. The Expo config uses it
for iOS Associated Domains and Android intent filters. After changing these
values, rebuild the native app:

```bash
pnpm --filter expo exec expo prebuild --clean
pnpm --filter expo exec expo run:ios
# or
pnpm --filter expo exec expo run:android
```

For iOS 17.4+ local testing without hosted AASA, append `?mode=developer` to the
Associated Domain entry.
