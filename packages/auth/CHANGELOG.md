# Changelog

## 0.0.7

### Added

- `signIn(context?)` and `rotate(context?)` accept a per-ceremony
  `{ email, policy }`.

  `email` seeds `allowCredentials`. Flows that resolve the account
  server-side — an account picker that never exposes addresses to an
  unauthenticated client — had no address to put in the request params, so the
  list came back empty. An empty list means a discoverable-credential prompt,
  and a credential registered with `residentKey: "discouraged"` is invisible to
  one: the authenticator can only offer it when the relying party names its id.
  Affected deployments saw "no credentials found" and read it as a missing
  security key.

  `policy` narrows or widens one ceremony without a second provider, so a
  deployment can register platform passkeys on a laptop and require portable
  security keys on a shared tablet. Supply it from server-side code that has
  decided the policy; map an untrusted client hint onto a policy on the server
  rather than letting the client name one.

### Changed

- The `securityKeysOnly` coupling — cross-platform attachment plus security-key
  hints on both halves of the ceremony — is defined once in `shared/webauthn`
  and shared by the provider factory and the override path. Releasing the
  constraint now clears every field it set; a partial release left a widened
  ceremony still refusing platform authenticators.
- The WebAuthn hint, attachment, resident-key and user-verification unions are
  named types in `shared/webauthn`, replacing four inline copies.

## 0.0.6

### Changed

- CLI only: the release runner executes the project-local Convex binary and
  hardens command execution. No runtime, component, or client changes.

## 0.0.5

### Breaking

- Revocation epochs are required component data again. The temporary
  compatibility readers, legacy session query, and component-owned epoch
  backfill from `0.0.5-alpha.0` have been removed after the known deployments
  completed their migration.
- The CLI now uses Convex's canonical `--deployment` selector. The hidden
  `--preview-name` and `--deployment-name` compatibility flags were removed.
- The component PKCE verifier operation is `token.pkce.accept`; the stale
  internal `consume` name was removed.

### Fixed

- Restored the durable-session expiration check in authenticated context
  resolution.
- Corrected authenticated context contracts for nullable accounts, session
  reads, and bounded multi-group membership reads, and made session listing
  deterministic without reading wall-clock time in a reactive query.
- `convex-auth urls` derives `.convex.site` endpoints from deployment names
  and `.convex.cloud` URLs. `convex-auth doctor` now checks required
  environment variables plus the mounted discovery and JWKS endpoints.
- Source and test typechecks now resolve the generated component contract from
  source, preventing stale `dist` declarations from masking API drift.

### Changed

- Removed migration-only epoch helpers, duplicate internal OAuth/XPath aliases,
  and stale retrieve/inspect/modify/delete/invalidate vocabulary from internal
  types and RPCs.
- The demo queues email through the durable Resend component. `RESEND_API_KEY`
  is optional at deployment time and produces a structured
  `EMAIL_NOT_CONFIGURED` error only when an email operation is requested.

## 0.0.4

### Breaking

- The low-level generated `api.auth.signIn` action now accepts a required
  `{ request: ... }` discriminated union. Provider IDs and credential params
  live together inside `request`; refresh uses `{ request: { refreshToken } }`.
  The browser, Expo, React, and Svelte clients keep the ergonomic
  `auth.signIn(provider, params)` method and wrap this transport automatically.
- Direct clients require `{ api: api.auth }`; proxy clients require
  `{ proxyPath }`. The two modes are mutually exclusive at the type level.
- Public user updates are limited to profile and configured extension fields.
  Email identity changes continue through `auth.user.email.*` rather than a
  generic patch.
- `auth.provider.signIn` now takes one object argument after `ctx`:
  `{ provider, accountId?, params? }`.
- Password reset completion is the required `recover` flow with
  `{ email, code, newPassword }`. The overloaded `verify` flow no longer accepts
  an optional `newPassword`; it is reserved for email verification.
- `authEnv` and `AuthEnv` were removed. Applications declare their own
  environment names and pass those values to provider and `defineAuth`
  configuration. Phone providers no longer discover
  `AUTH_<PROVIDER_ID>_KEY`; capture delivery credentials in `send` instead.
- Library-internal API result types, component handles, raw document types, and
  raw document validators are no longer exported from the server entry point.
  Applications rely on the inferred `defineAuth` result, generated `api.auth`,
  handler-local `ctx.auth`, and the configured `auth.v` validators instead.
- New users and sessions write explicit revocation epochs. Existing deployments
  must retain compatibility reads until their pre-epoch rows are backfilled.

### New

- Custom credential validators now survive Convex codegen. Passing generated
  `api.auth` directly to `client` preserves literal provider IDs, validated
  params, exact action results, and configured factor capabilities without a
  generic, handwritten client interface, or assertion.
- `ctx.auth.credentials.verify` and `ctx.auth.credentials.provision` bind a
  credentials proof to `passkeys.signIn()` or `passkeys.rotate()` without an
  intermediate session. The successful WebAuthn assertion or registration is
  the only operation that issues the final session.
- `auth.account.list(ctx, { userIds, provider? })` performs a safe, redacted,
  bounded batch read for as many as 100 users in one component call. Account,
  session, invite, user, group, and membership facade IDs retain their component
  table brands.
- `createAuthTest(t, components.auth)` creates typed users, groups,
  memberships, sessions, and `t.withIdentity` claims backed by real component
  records.
- Configured `User`, `Group`, `GroupMember`, and `GroupInvite` extension
  validators now type both facade writes and reads. Omitted validators infer
  `unknown`, never `any`.
- Password recovery can require passkey rotation with
  `password({ reset, afterReset: passkeys.rotate() })`. OTP verification creates
  a short-lived, provider-bound continuation without issuing a session. The
  replacement passkey, staged password, old passkeys, old sessions, and final
  session are committed in one transaction, and platform clients automatically
  complete the WebAuthn ceremony.
- `auth.provider.continue(ctx, { userId, operation })` composes typed provider
  operations without caller-authored mode or purpose strings.
- The setup wizard declares Convex's system-provided `CONVEX_SITE_URL` in
  `convex.config.ts`, so generated `env` types validate the issuer wiring
  without a process-environment assertion.
- Convex 1.45 is now the minimum supported peer. Component validators derive
  documents and IDs from the schema with `schema.doc()` and `schema.id()`, and
  the Stream PR 1 package preview backs bounded auth-event retention.

### Fixed

- Protected handlers resolve the user, durable session, active group,
  membership, role, and grants through one component snapshot. Callers reuse
  `ctx.auth` instead of repeating user and active-group reads.
- Session access tokens are capped by the durable session's absolute expiry.
  Refresh, device, TOTP, password, and WebAuthn paths cannot extend a JWT past
  the session row that authorizes it.
- `auth.user.remove` preflights one globally bounded cascade before its first
  write, removes every user-owned credential and session row atomically, and
  clears attribution on shared OAuth clients, invites, and webhook endpoints.
- Batch selectors and SCIM provisioning reject more than 100 items before
  database work. Component pagination uses the schema-aware paginator rather
  than unbounded collection or built-in component pagination.
- Component queries no longer read wall-clock time. Epoch-millisecond deadlines
  remain in mutations and actions, while redundant creation timestamps use
  Convex's `_creationTime`.

## 0.0.1

First stable release under the `@estifanos-sh/convex-auth` package name. It
includes the changes tested in `0.0.1-preview.1` and `0.0.1-preview.2`.

## 0.0.1-preview.2

### Breaking

- **Require the versioned auth keyring.** `AUTH_KEYS` is now the sole runtime
  source for signing, verification, secret encryption, and WebAuthn masking
  material. The legacy `JWT_PRIVATE_KEY`, `JWKS`, and
  `AUTH_SECRET_ENCRYPTION_KEY` fields are no longer declared by `authEnv` or
  read by the server. Run the setup wizard once to bundle an existing complete
  legacy key set without rotating it before deploying this version.

### Fixed

- Include every source map referenced by published JavaScript and declaration
  files, and fail package validation if a future build leaves a dangling map
  reference.

## 0.0.1-preview.1

### Breaking

- **Make expensive and privileged behavior explicit.** `auth.member.get` and
  `assert` are direct-only; use `member.resolve` for inherited traversal.
  `member.list` no longer accepts `withGroup` or `withGrants` projection modes.
- **Replace raw account/factor access with current-user management.** The public
  account surface is now `account.list/remove`; use `factor.list/update/remove`
  for sanitized WebAuthn and TOTP management. Credential creation, lookup, and
  updates remain capability-scoped to provider callbacks. WebAuthn backing
  accounts are excluded from `account.list/remove` so passkeys have one atomic
  management path.
- **Move linking into verified provider ceremonies.** Custom credentials
  providers can return `{ provision: { account, profile, match? } }`; the
  runtime provisions the account before session issuance. The unverified
  `auth.account.link` helper was removed.
- **Normalize state-changing arguments.** Active group update is now
  `active.update(ctx, { groupId, userId? })`; `active.reset` replaces the
  misleading `remove`. Token invite acceptance is
  `invite.token.accept(ctx, { token })` and derives the user from auth context.
  `user.remove(ctx, { id })` always cleans up all auth-owned child records.
- **Replace the router escape hatch.** `auth.request.routes()` returns stable
  Convex route descriptors for handler adapters; `request.router()` was removed.
- OAuth code/refresh internals and OAuth secret-verification helpers are no
  longer on the app facade. `auth.oauth.authorize` remains public.
- **Remove `auth.group.get(ctx, { id, tree: true })`.** Use
  `auth.group.ancestors(ctx, { groupId })` for explicit hierarchy traversal and
  direct `get`/`list` calls for the current group and children.

### New

- **One versioned auth keyring.** New deployments store independent JWT signing,
  public verification, secret-encryption, and WebAuthn response-masking material
  in one CLI-managed `AUTH_KEYS` value. Existing `JWT_PRIVATE_KEY`, `JWKS`, and
  `AUTH_SECRET_ENCRYPTION_KEY` deployments remain supported as a deprecated
  fallback.
- **Restore deliberate extension points.** `auth.provider.signIn` and
  `auth.event.emit` are public for app-owned provider orchestration and domain
  audit events.
- **Transactional active-group reads/writes.** Preference validation and
  deterministic membership fallback now run in dedicated indexed component
  functions rather than bounded facade scans.
- **Canonical WebAuthn provider** — `webauthn()` replaces `passkey()` and groups
  ceremony preferences under `registration` and `authentication`. The browser
  and Expo client surface is now `client.webauthn`, and supporting browsers
  receive typed, non-binding WebAuthn hints without credential-policy tagging
  or stored-credential migration.

## 0.0.4-preview.40

### New — upstream feature parity (in our conventions)

- **`auth.user.id(ctx)` / `auth.session.id(ctx)`** — ownership-nested
  shortcuts for the current session's user / session id. Returns `null`
  when unauthenticated. Pairs with `auth.user.viewer(ctx)` (full doc) and
  the existing facade. Internal helper `getAuthSessionId` from
  `server/sessions.ts` is unchanged.
- **`auth.account.link(ctx, { provider, profile })`** — attach an additional
  provider account to the current authenticated user. Idempotent against
  same `(provider, providerAccountId)` on the same user. Throws
  `ACCOUNT_ALREADY_LINKED` if the provider account belongs to a different
  user. When the current user is anonymous (`isAnonymous: true`), also
  flips `isAnonymous: false` and merges `name`/`image`/`email` from the
  profile — folds the upstream "upgrade anonymous account" verb into one
  primitive. Fires `after({ kind: "userUpdated" })`.
- **Per-provider `updateProfileOnLogin?: boolean` on OAuth providers**
  (`google`, `github`, `apple`, `microsoft`, `custom`). Defaults to `true`
  to match Auth.js / Clerk / SSO conventions: on a returning OAuth
  sign-in, `User.name` / `image` / `email` are refreshed from the new
  profile. Set to `false` per-provider when the app owns the canonical
  user profile. **Behavior change** — apps that previously hand-edited
  user fields will see them overwritten on next OAuth sign-in; opt out
  with `google({ updateProfileOnLogin: false, ... })`.
- **`@estifanos-sh/convex-auth/react`** subpath — ships `ConvexAuthProvider`,
  `useAuth()`, `useAuthActions()`, `useConvexAuthClient()`, and gate
  components for an app-owned browser auth client. `useAuth()` returns the
  public discriminated state:
  `{ status: "loading", token: null } | { status: "signedOut", token: null } | { status: "signedIn", token: string }`.
  `react` is **not** a declared peer dep — consumers who use this subpath bring
  their own React (any React app already has it).
- **`@estifanos-sh/convex-auth/svelte`** subpath — ships `setupConvexAuth`,
  `useConvexAuth()`, and gate components for Svelte 5 apps. The binding bridges
  an app-owned browser auth client into a reactive runes object instead of
  owning client construction.

### Verified already covered (no change)

- `auth.session.invalidate(ctx, { userId, except? })` already exists in
  `server/core.ts:491` — sign-out-everywhere works without a new verb.
- After-callbacks via `after: (ctx, event)` (`server/types.ts`).
- JWT bring-your-own-issuer via `acceptedIssuers` in `server/prefetch.ts`.
- Per-provider OAuth `redirectUri` + `accountLinking`.

### Not adopted

- `server-only` marker package — Convex's runtime doesn't set the
  `react-server` export condition that makes the package a no-op, so
  importing it would throw at load time inside Convex functions. Skip.

## 0.0.4-preview.39

### Breaking

- **Drop the `RateLimit` table.** Sign-in throttling now uses
  `@convex-dev/rate-limiter` (mounted as a subcomponent). Custom token-bucket
  math in `server/limits.ts` and the `RateLimit` schema row + `vRateLimitDoc`
  / `vRateLimitResult` validators are gone. Existing throttle state is lost
  (resets every identifier to "no failures recorded") — safe for this preview
  release. Public wrappers `isSignInRateLimited`/`recordFailedSignIn`/
  `resetSignInRateLimit` keep their signatures.
- **`AuthComponentApi.rateLimit` → `AuthComponentApi.limits`.** The component
  namespace for rate-limit operations is now `auth.limits.signInCheck` /
  `signInRecord` / `signInReset` instead of the old `auth.rateLimit.{get, create,
update, delete}` table CRUD. Internal — most consumers won't see this.
- **All component `query`/`mutation` are now `internalQuery`/`internalMutation`.**
  107 functions across `component/public/*` flipped visibility. Defense in
  depth: the auth component's internals aren't client-callable through any
  parent app's API. Server-side `ctx.runQuery`/`runMutation` calls are
  unaffected.

### New

- **`@convex-dev/workpool` powers webhook delivery, with HMAC-signed payloads.**
  Mounted as `webhookWorkpool` inside the auth component.
  `groupWebhookDeliveryCreate` now enqueues a new `groupWebhookDeliveryDispatch`
  `internalAction` that performs the HTTP POST and patches delivery status.
  Workpool drives retry/backoff (5 attempts, 1s initial, 2× base).

  Endpoint signing secrets are now stored encrypted at rest
  (`GroupWebhookEndpoint.secretCiphertext`, AES-GCM via
  `AUTH_SECRET_ENCRYPTION_KEY`) — the prior `secretHash` field was never used
  and is replaced. Auth events are the durable source of truth; subscribed
  webhook deliveries are projected from those events, decrypt the endpoint
  secret, and HMAC-SHA256-sign `${signedAt}.${body}` where `body` is the exact
  JSON the dispatch action sends. Signature + timestamp are stored on the
  delivery row.

  Wire format (subscribers verify by reconstructing the pre-image and HMAC):
  - `Content-Type: application/json`
  - `X-Auth-Event-Type: <kind>`
  - `X-Auth-Delivery-Id: <deliveryId>`
  - `X-Auth-Timestamp: <epochMs>`
  - `X-Auth-Signature: sha256=<hex>`
  - Body: `{ "kind": "...", "payload": {...} }`

- **Daily cleanup cron** inside the component (`component/crons.ts`) drives
  `pruneExpired` against Session / RefreshToken / VerificationCode /
  AuthVerifier / GroupInvite / DeviceCode at 03:00 UTC. Per-table batch size
  capped at 200 (default) / 1000 (max).

### Internal

- **Typed patch validators on all `*Patch` mutations.** Replaced
  `data: v.any()` on 12 mutations (userPatch, accountPatch, refreshTokenPatch,
  verifierPatch, passkeyUpdate, totpUpdate, deviceUpdate, groupUpdate,
  memberUpdate, groupConnectionUpdate, groupWebhookEndpointUpdate,
  groupWebhookDeliveryPatch) with `data: v.object({ ...fields, all
v.optional })`. Catches typo'd / unknown patch fields at the
  validation boundary instead of silently writing them.

- `convex-test` catalog bumped to `^0.0.53` to match what `@convex-dev/rate-limiter`
  and `@convex-dev/workpool` pull in.

- `@estifanos-sh/convex-auth/test` `register()` now also registers the
  `auth/rateLimiter` and `auth/webhookWorkpool` subcomponents — required
  for `convex-test` setups that exercise sign-in flows or webhook delivery.

## 0.0.4-preview.38

### Breaking

- **Bump minimum `convex` to `^1.39.0`.** Aligns with Convex's new
  `ComponentDefinition<any, any>` shape (typed `env` slot) and the
  `ValidatorTypeToReturnType` re-export from `convex/server`.
- **Drop the `fluent-convex` wrapper from the component.** The internal
  `query`/`mutation`/`action` builders in `packages/auth/src/component/functions.ts`
  now re-export Convex's native factories directly. `fluent-convex` is no
  longer a runtime dependency, and the `postinstall` patch script
  (`scripts/patch-fluent-convex.mjs`) has been removed. `fluent-convex` is
  still available as an external integration if you want it in your own
  app code — see the docs page.
- **Replace `auth.context(ctx, { optional: true })` with `auth.context.optional(ctx)`.**
  Mirrored across the three facade entry points:
  - `auth.context(ctx, { optional: true })` → `auth.context.optional(ctx)`
  - `auth.ctx({ optional: true })` → `auth.ctx.optional()`
  - `auth.request.context(ctx, req, { optional: true })` → `auth.request.context.optional(ctx, req)`

  The `optional` key is removed from `AuthContextConfig` and
  `HttpAuthContextConfig`; `require`, `active`, `resolve`, and `authResolve`
  are unchanged. Splitting the optional path eliminates the 2-overload
  union that produced opaque inference errors at call sites.

- **Pagination shape now matches Convex's native `PaginationResult<T>`.**
  All `*List` queries (user, group, member, invite, key, sso connection)
  return `{ page, isDone, continueCursor }` instead of the custom
  `{ items, nextCursor: string | null }`. Args switch from
  `{ limit, cursor }` to `{ paginationOpts }` (using
  `paginationOptsValidator` from `convex/server`). Consumers can now pass
  these queries directly to `usePaginatedQuery` from `convex/react`
  without any client-side adaptation. The server-side wrappers
  (`auth.user.list(ctx, { limit, cursor, … })`) keep the flat options shape
  but return the native pagination result.

  Migration:
  - `result.items` → `result.page`
  - `result.nextCursor === null` → `result.isDone`
  - `result.nextCursor` (non-null cursor) → `result.continueCursor`
  - Raw `ctx.runQuery(component.user.list, { limit, cursor })` →
    `ctx.runQuery(component.user.list, { paginationOpts: { numItems, cursor } })`

### Internal

- Consolidate `auth.v.*` validator field maps to a single source of truth.
  `userFields`, `groupFields`, `memberFields`, `inviteFields`, `emailFields`
  in `component/model.ts` are now generic field-map builders parameterized
  on the ID-validator function. The strict component-internal variants
  (`vUserDoc`, etc.) use `v.id`; the permissive cross-boundary variants in
  `server/validators.ts` use `vIdString`. Both sides stay in lockstep
  automatically — adding a field happens in one place.
- `groupAuditEventCreate` auto-populates `ip` and `requestId` from
  `ctx.meta.getRequestMetadata()` (Convex 1.38+) when callers don't pass
  them explicitly. Falls through silently in contexts where `ctx.meta`
  isn't available (e.g. some test harnesses).

## Unreleased

- Stabilize the group/connection namespace model around `auth.sso.mount(...)` for
  inbound SSO, `mounted.admin.scim.*` for provisioning, and a planned
  `auth.oauth.*` provider-mode surface.
- Move public domain ownership under `mounted.admin.connection.*` and keep the
  next release focused on shipping this stable core shape before larger group
  features land.
- Harden group SSO management surfaces by adding tenant-admin checks to the
  app-level Convex wrappers and tightening their public return schemas.
- Redact sensitive OIDC and webhook secret material from public reads and stop
  advertising incomplete provider-mode metadata from discovery.
- Centralize identity subject parsing for device, passkey, and TOTP flows and
  add regression coverage for normalized public API outputs.
- Store group OIDC client secrets outside raw group connection config and have
  the CLI provision `AUTH_SECRET_ENCRYPTION_KEY` automatically.
- Refresh group docs to reflect the current policy scope and provider-mode
  status.
- Add first-class group connection domain verification with
  `mounted.admin.connection.domain.verification.request/confirm` and flat
  `requestDomainVerification` / `confirmDomainVerification` RPC helpers.
- Require verified group connection domains for
  `mounted.client.signIn({ email | domain })` routing while keeping explicit
  `connectionId` sign-in available for setup.

## 0.0.4-preview.12

- Add multi-tenant group helpers under `auth.user.group.*`:
  - `switch(ctx, { userId, groupId })` — set or clear a user's active group.
  - `active(ctx, { userId })` — get user's active group ID.
  - `inherit(ctx, { userId, groupId, roles?, maxDepth? })` — resolve membership
    through ancestor groups without throwing.
  - `require(ctx, { userId, groupId, roles?, maxDepth? })` — same as `inherit`
    but throws `FORBIDDEN` when no membership is found.
- Add `auth.group.ancestors(ctx, { groupId, maxDepth?, includeSelf? })` for
  walking group hierarchies toward the root.
- Extend `auth.user.group.list()` with `includeGroup` option to join group data
  onto each membership record.
- Add `FORBIDDEN` and `NO_ACTIVE_GROUP` error codes.
- Fix all component `ctx.db.get/patch/delete` calls to pass explicit table
  names.
- Migrate toolchain from ESLint + Prettier to Oxlint + Oxfmt.
- Enable tsgo (`convex.json` with `typescriptCompiler: "tsgo"`).

## 0.0.4-preview.10

- Enforce explicit return validators for all auth component public endpoints so
  generated function references expose concrete output types instead of `any`.
- Tighten component function wrappers to bind handler return types to declared
  validators, including `null` outputs for no-return handlers.

## 0.0.4-preview.9

- Fix SSR issuer validation in `server()` so `url` stays the Convex API URL
  (`*.convex.cloud`) while tokens issued by the matching `*.convex.site`
  deployment are accepted by default.
- Add `acceptedIssuers` to `server()` options for explicit issuer override in
  `refresh()` and `verify()` flows.
- Add regression coverage for cloud/site issuer compatibility, unrelated issuer
  rejection, and explicit issuer override behavior.
- Clarify SSR docs: `url` is the Convex deployment URL, issuer validation rules,
  and a minimal SvelteKit proxy-mode setup.
- Harden proxy refresh handling by keeping a still-valid access token when the
  refresh-token cookie is temporarily missing, and by preserving rejection for
  invalid issuers.
- Retry transient proxy refresh failures client-side before falling back to
  signed-out state.
- Improve same-origin detection behind reverse proxies by honoring
  `x-forwarded-proto` in SSR helper checks.

Migration note:

- Most SSR proxy-mode apps need no changes after upgrading.
- If you use a custom JWT issuer, set `acceptedIssuers` explicitly in
  `server({...})`.

## 0.0.4-preview.8

- Breaking preview update: normalized auth action references to
  `auth/session:start`, `auth/session:stop`, and `auth/store:run`; removed
  legacy aliases.
- Breaking preview update: renamed auth component tables to PascalCase
  identifiers (for example `User`, `Session`, `Account`, `RefreshToken`) and
  propagated the new names through component/server types and queries.
- Breaking preview update: provider APIs now use lowercase factory functions
  (`google(...)`, `github(...)`, `password(...)`, `passkey(...)`, `totp(...)`,
  `device(...)`, `anonymous(...)`, `email(...)`, `phone(...)`, `sso(...)`) with
  no class-based aliases.

## 0.0.4-preview.7

- Isolate auth cookies by namespace in SSR server helpers. A deterministic
  deployment-based namespace is now used by default, and apps can override it
  with `cookieNamespace` to prevent localhost cross-app cookie collisions.
- Add issuer compatibility guards in token verification/refresh paths to clear
  foreign deployment tokens instead of treating them as authenticated sessions.
- Harden refresh handling for malformed refresh-token cookie values and add
  security regressions for namespace isolation and issuer mismatch behavior.

## 0.0.4-preview.6

- Harden proxy-mode client handshake confirmation by keeping in-flight
  handshakes pending across transient Convex `onAuthChange(false)` callbacks,
  instead of immediately rejecting with `AUTH_HANDSHAKE_REJECTED`.
- Add a unique JWT `jti` claim to issued access tokens so rapid refresh/sign-in
  cycles always produce distinct tokens for Convex auth confirmation.
- Add regression coverage for handshake race conditions and a proxy sign-up +
  invite-accept flow.

## 0.0.4-preview.5

- Breaking preview update: `isAuthenticated` on the client now represents
  server-confirmed auth state instead of local token presence. Sign-in flows now
  wait for Convex auth confirmation and throw structured handshake errors on
  rejection/timeout.
- Invite APIs now support token-first acceptance flows: create returns raw
  invite token, acceptance can be performed by token, invite expiration is
  enforced, and group membership is ensured atomically during acceptance.
- Breaking preview API update: removed `auth.invite.getByToken(...)` and
  `auth.invite.acceptByToken(...)`. Use `auth.invite.token.get(...)` and
  `auth.invite.token.accept(...)` instead.
- Token invite acceptance now requires matching invite email, but no longer
  requires the accepting user email to already be verified.
- Server refresh/proxy behavior is more resilient: transient OAuth code exchange
  and token refresh failures preserve active sessions instead of eagerly
  clearing cookies; terminal failures still clear verifier state.

## 0.0.91

- Fix proxy-mode client token wiring so `convex.setAuth(fetchAccessToken)` is
  re-synced after token updates (sign-in, TOTP, passkey, device), enabling
  authenticated direct Convex queries/mutations after SSR/proxy sign-in.
- Preserve existing auth cookies on OAuth code exchange errors and non-refresh
  proxy sign-in errors instead of force-clearing active sessions.
- Improve auth hardening: validate missing PKCE verifier cookies during OAuth
  callbacks, make localhost detection robust without requiring explicit ports,
  avoid cross-origin cookie mutation during server-side refresh handling, and
  add cycle guards to refresh-token subtree invalidation.
- Improve client resilience in browsers by handling storage read/write failures
  gracefully, deduplicating global storage listeners, and serializing manual
  refresh locks with a safer mutex fallback in environments without Web Locks.

## 0.0.90

- fix negative `shouldHandleCode` logic for client

## 0.0.89

- Accept `shouldHandleCode` as a boolean or function, and support async function
  in middleware.

## 0.0.88

- Add new cli options `--allow-dirty-git-state` and `--web-server-url <url>` to
  enable running non-interactively.

## 0.0.87

- Add missing `shouldHandleCode` prop to Next.js server provider

## 0.0.86

- Fix RN enviornment checks for Expo 53+ for real

## 0.0.85

- Fix RN enviornment checks for Expo 53+

## 0.0.84

- Accept `shouldHandleCode` in ConvexAuthProvider

## 0.0.83

- Fix auth error messages not propagating from backend to client for Next.js

## 0.0.82

- Add `shouldHandleCode` prop to React/Next.js clients and Next.js middleware to
  allow for custom code handling.

## 0.0.81

- Retry token fetch on network errors
- Update the CLI script to work in non-interactive terminals

## 0.0.80

- Fix a race when quickly refreshing a page or using redirects that refresh the
  page.

## 0.0.79

- Expose function reference types `SignInAction` and `SignOutAction` for the
  benefit of other client implementations (Svelte, Solid, etc.). As with all
  APIs in the library these are not stable and may change until this library
  reaches 1.0.

- Add a platform check in the recommended `ConvexAuthProvider` use for React
  Native in docs.

- Fix auth refresh silent failure for React Native. This has been a slippery
  issue, if you use Convex Auth in a React Native app please let us know if this
  fixes for you.

## 0.0.78

- Add support for
  [custom OAuth callback and sign-in URLs](https://labs.convex.dev/auth/advanced#custom-callback-and-sign-in-urls)

- Next.js middleware function `isAuthenticated` fails more loudly; previously it
  returned false in the case of a Convex backend that didn't expose an endpoint
  called `auth:isAuthenticated`, now it throws an error. This should help people
  with the migration required for 0.0.76.

## 0.0.77

- Fix syntax of an import to work with convex-test.

## 0.0.76

- BREAKING: A change in the logic for isAuthenticated for Next.js: it now
  involves a server-side check. Update your auth.ts file by adding a new
  `isAuthenticated` endpoint to the list of exported Convex functions, like

  ```
  export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth(...
  ```

  If you're not using Next.js, you should still add this named export as it's
  the new suggested set of publicly exposed endpoints, but nothing should break
  if you don't.

- Potentially breaking: For NextJS, switched to `path-to-regexp` 6.3.0 to avoid
  ReDoS vulnerability. That version, while protected from the vulnerability, has
  less expressive RegEx pattern support. If you are using `createRouteMatcher`
  in middleware, it might not match some patterns that were previously available
  in the 0.7.x series. See the docs for supported patterns:
  https://www.npmjs.com/package/path-to-regexp/v/6.3.0.
- Upgraded legacy OAuth internals to 0.37.3.
- Updated OAuth integration docs for supported providers (available at
  https://labs.convex.dev/auth/config/oauth).

## 0.0.75

- BREAKING: `convexAuthNextjsToken()` and `isAuthenticatedNextjs()` now return
  promises so must be `await`ed.
- Support for Next.js 15.
- Update convex peer dependency to ^1.17.0

## 0.0.74

- Fix to header propagation in Next.js middleware
- Update Password provider to separate password requirement validation from
  custom profile information
  - **Breaking** If using Password with a custom profile to enforce password
    requirements, you must now implement `validatePasswordRequirements`

## 0.0.73

- Update implementation of refresh tokens reuse **Note:** After upgrading to
  this version, downgrading will require migrating the `authRefreshTokens` table
  to drop the `parentRefreshTokenId` field.
- Add configuration for cookie age in Next.js middleware

## 0.0.72

- Upgrade + pin legacy OAuth internals to 0.36.0 to avoid issues with mismatched
  types

## 0.0.71

- Fix bug with setting auth cookies on Next.js response

## 0.0.70

- Improve error handling when calling Convex auth functions from Next.js

## 0.0.69

- Add a 10s reuse window for refresh tokens

**Note:** After upgrading to this version, downgrading will require migrating
the `authRefreshTokens` table to drop the `firstUsedTime` field.

- Fix exported type for `signIn` from `convexAuth`

## 0.0.68

- [Next.js] Propagate auth cookies in middleware follow up
- Introduce `convexAuth.isAuthenticated()` and `convexAuth.getToken()` in favor
  of `isAuthenticatedNextJs()` and `convexAuthNextJsToken()` for middleware.

## 0.0.67

- [Next.js] Propagate auth cookies in middleware

## 0.0.66

- [Next.js] Match auth routes to proxy to Convex with and without trailing slash

## 0.0.65

- Add verbose logging to Next.js middleware

## 0.0.64

- Fix issue with re-entrant `fetchAccessToken` with a mutex

---

Previous versions are documented in git history.
