## What it provides

Convex Auth brings passwords, OAuth, magic links, passkeys, TOTP, anonymous
access, phone, and device flow into one user and session lifecycle. It also
provides group memberships and permissions, OIDC/SAML/SCIM connection
administration, API keys, and SSR integrations without requiring application
code to build a second authentication system.

## Current API

The current API uses Convex-native setup vocabulary:
`defineAuth`, `definePermissions`, `permissions`, `grants`, object args,
native Convex pagination, application-owned provider environment values, and a flat group
connection (SSO) admin facade `auth.connection.*`. See
[`packages/auth/MIGRATION-vNext.md`](./packages/auth/MIGRATION-vNext.md) for
the breaking-change migration notes.

## API design

`@estifanos-sh/convex-auth` is a Convex component, but unlike single-purpose
components — which you instantiate as a class (`new RateLimiter(components.rateLimiter)`,
`new Resend(components.resend)`) — it spans many domains: users, sessions,
accounts, group memberships, SSO connections, OAuth clients, and API keys.
Rather than one class with dozens of methods, it uses a definition-first factory
that returns a facade namespaced by domain:

```ts
import { defineAuth } from "@estifanos-sh/convex-auth/server";
import { definePermissions } from "@estifanos-sh/convex-auth/permissions";
import { connection, google, password } from "@estifanos-sh/convex-auth/providers";
import { components } from "./_generated/api";

export const permissions = definePermissions({
  grants: ["members.read", "sso.connection.manage"],
  roles: { admin: { label: "Admin", grants: ["members.read"] } },
});

export const auth = defineAuth(components.auth, {
  providers: [password(), google(), connection()],
  permissions,
});

// Every method is (ctx, objectArgs), grouped by domain:
await auth.user.get(ctx, { id });
await auth.member.assert(ctx, { userId, groupId, roleIds: ["admin"] });
await auth.connection.create(ctx, { groupId, protocol: "oidc" });
```

Configuration is passed once to `defineAuth`; related operations live under
`auth.user.*`, `auth.session.*`, `auth.account.*`, `auth.member.*`,
`auth.invite.*`, `auth.connection.*`, `auth.oauth.*`, `auth.key.*`, and
`auth.request.*`. All methods take Convex-native object args (`{ id }`,
`{ ids }`, `{ userId }`, `{ where }`, `{ paginationOpts }`, `{ data }`,
`{ patch }`) and return Convex-native shapes (`Doc | null`, `PaginationResult`).
`defineAuth` is the single canonical setup entry point — see
[`packages/auth/LEXICON.md`](./packages/auth/LEXICON.md) for the full naming and
shape contract.

`auth.connection.*` is a server facade enabled by `connection()`, not a
browser API. An application exposes only the authorized connection operations
its administration UI needs through its own Convex functions. The component
continues to own users, credentials, sessions, passkeys, and protocol state;
application tables should store auth IDs as references rather than mirror those
records or implement another session or WebAuthn lifecycle.

The generated actions are also the client type contract:

```ts
import { client } from "@estifanos-sh/convex-auth/browser";
import { api } from "../convex/_generated/api";

export const authClient = client({ convex, api: api.auth });
```

Provider IDs, custom credential parameters, action results, and enabled factor
helpers flow through `api.auth`. Applications do not need `InferClientApi`, a
handwritten client interface, or an assertion.

## Package exports

| Import path                                              | Use                                                                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `@estifanos-sh/convex-auth/server`                       | Backend: `defineAuth`, the `auth.*` facade, `authEvents`, and HTTP route helpers                                            |
| `@estifanos-sh/convex-auth/convex.config`                | The component definition for `app.use(auth)` in `convex.config.ts`                                                          |
| `@estifanos-sh/convex-auth/permissions`                  | `definePermissions` and the grant/role types                                                                                |
| `@estifanos-sh/convex-auth/providers` (+ `/providers/*`) | Auth providers: `password`, `google`, `github`, `apple`, `microsoft`, `webauthn`, `totp`, `anonymous`, `email`, `device`, … |
| `@estifanos-sh/convex-auth/client`                       | Framework-agnostic browser client factory (`client()` — sign-in/out, token store)                                           |
| `@estifanos-sh/convex-auth/react`                        | React bindings: `useAuth(client)` and gates receiving the app-owned client                                                  |
| `@estifanos-sh/convex-auth/svelte`                       | Svelte 5 bindings: `useConvexAuth(client)` reactive state                                                                   |
| `@estifanos-sh/convex-auth/expo`                         | React Native / Expo client                                                                                                  |
| `@estifanos-sh/convex-auth/browser`                      | Low-level browser primitives (navigation, WebAuthn, web locks)                                                              |

## Documentation

**[estifanos.sh/convex-auth](https://estifanos.sh/convex-auth/)**

| Section                                                                           | Description                                                     |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [Getting Started](https://estifanos.sh/convex-auth/getting-started/installation/) | Installation, providers, environment variables                  |
| [API Reference](https://estifanos.sh/convex-auth/api/user/)                       | `auth.user`, `auth.session`, `auth.group`, `auth.key`, and more |
| [Group SSO](https://estifanos.sh/convex-auth/connection/overview/)                | OIDC, SAML, SCIM, audit, webhooks                               |
| [SSR Integration](https://estifanos.sh/convex-auth/ssr/overview/)                 | SvelteKit, TanStack Start, Next.js                              |
| [Guides](https://estifanos.sh/convex-auth/guides/multi-access/)                   | Multi-access, device flow, authorization, production            |
| [Reference](https://estifanos.sh/convex-auth/reference/config/)                   | Config options, error codes, CLI, architecture                  |

## Agent Skills

Install focused setup and review workflows for Codex, Claude Code, Cursor, and
other Agent Skills-compatible coding agents:

```bash
npx skills add estifanos-sh/convex-auth --all
```

See the [Agent Skills documentation](https://estifanos.sh/convex-auth/ai/agent-skills/)
or use the compact [`llms.txt`](https://estifanos.sh/convex-auth/llms.txt)
documentation index.

## Contributing

```bash
vp install
vp run check
vp test --run --project convex
```

| Directory       | Description                                     |
| --------------- | ----------------------------------------------- |
| `packages/auth` | Auth component, server helpers, providers, CLI  |
| `tests/`        | Vitest test suite (convex + node projects)      |
| `docs/`         | Product documentation content and configuration |

## License

[Apache-2.0](./LICENSE)
