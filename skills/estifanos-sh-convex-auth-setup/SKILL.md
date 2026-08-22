---
name: estifanos-sh-convex-auth-setup
description: Install, configure, upgrade, or extend @estifanos-sh/convex-auth in an existing Convex application and verify a real sign-in flow. Use for initial setup; adding password, OAuth, passkey/WebAuthn, email, phone, anonymous, TOTP, device, or enterprise connection providers; wiring auth.config.ts and HTTP routes; connecting React, Svelte, Expo, or SSR clients; configuring MCP OAuth; or repairing an incomplete setup. Do not use for @convex-dev/auth.
---

# Set up estifanos.sh Convex Auth

<!-- cspell:ignore bunx -->

Produce a version-correct integration that signs in end to end. Prefer the
package CLI for the shared server scaffold, then make only the provider and
framework changes the app needs.

## 1. Establish scope

Read project instructions before running commands. Inspect:

- `package.json`, the lockfile, and the package manager;
- `convex.json` and the configured Convex functions directory;
- existing `convex.config.*`, `auth.*`, `auth.config.*`, and `http.*` files;
- client framework entrypoints and any existing auth provider;
- the target deployment type.

Preserve unrelated changes. Do not target production unless the user explicitly
requested it and the command identifies the production deployment before
changing state.

## 2. Pin guidance to the app

If the package is installed, read its version and public exports first. Inspect
the installed `.d.ts` for any option being configured. If it is not installed,
install the current stable package with the project's package manager.

Use `https://estifanos.sh/convex-auth/llms.txt` as the documentation index.
Fetch only the specific Markdown pages needed. Never copy an unreleased GitHub
example into a stable-package integration without calling out the mismatch.

Recommend `npx convex ai-files install` when Convex AI guidance is absent or
stale, but keep that separate from installing this skill bundle.

## 3. Create the server scaffold

Ensure a Convex development deployment exists. Follow project instructions
about dev processes; do not start a duplicate watcher. Run the package CLI with
the detected package runner and a concrete frontend origin:

```bash
npx convex-auth --app-url "http://localhost:5173"
```

The wizard creates keys and shared files. If the environment is non-interactive,
make the same changes deliberately using
[references/server.md](references/server.md); do not invent deployment secrets.

Review existing files rather than overwriting them. The resulting setup must
include:

- the component registered with `defineApp()` and `app.use(auth)`;
- one canonical `defineAuth(components.auth, config)` definition;
- app HTTP routes from `auth.http()`;
- a Convex JWT trust entry in `auth.config.*`;
- protected query/mutation builders derived from the configured `auth.ctx()`.

## 4. Configure only requested providers

Read [references/providers.md](references/providers.md) for provider-specific
rules. Import providers from `@estifanos-sh/convex-auth/providers` or the matching
provider subpath exposed by the installed package.

- Read secrets from generated server `env`; never use non-null assertions to
  conceal an actually optional production secret.
- Configure callback URLs at the provider console from the app's actual Convex
  site origin.
- Do not enable password reset, email verification, SMS, SSO, or MCP OAuth
  without also wiring their required delivery, pages, scopes, and routes.
- For WebAuthn, separate passkey UX from hardware-attestation policy. Do not
  claim `authenticatorAttachment` or `hints` enforce physical security keys.

## 5. Connect the client

Read [references/clients.md](references/clients.md) and use only the section for
the detected framework.

Create exactly one browser auth client and one owner for its token lifecycle.
Pass only `api.auth` to the client. Do not expose the full component API or
server configuration to browser code.

Build the smallest sign-in UI that proves the configured provider works. Reuse
the application's design system; do not introduce a second component library
for auth controls.

## 6. Verify the complete flow

Run the package doctor and the repository's normal checks:

```bash
pnpx @estifanos-sh/convex-auth doctor
```

Then verify, in proportion to the change:

1. The project type-checks and builds.
2. The auth discovery/JWKS endpoints are mounted.
3. A new user can complete the chosen sign-in ceremony.
4. The client reaches signed-in state and an authenticated Convex function sees
   the expected identity.
5. Sign-out clears the client state and protected data is unavailable.
6. A negative case fails: invalid credentials, wrong origin, missing grant, or
   an untrusted authenticator as applicable.

For OAuth, WebAuthn, email, phone, and UI-facing changes, a successful build is
not enough—exercise the browser flow. Stop only for the exact human action that
cannot be automated, then continue afterward.

## Completion checklist

- Installed version and documentation source identified
- No competing auth lifecycle remains
- Secrets stay server-side and out of git
- Development and production origins are not conflated
- `doctor`, typecheck, and build pass
- Positive and negative auth behavior verified
- Remaining provider-console or production steps reported precisely
