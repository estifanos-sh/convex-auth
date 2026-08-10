# Convex-Helpers Adoption Dossier

Pass 2B output (research) + Pass 2D-1 execution notes (what actually shipped).

## Status

| Pass | What                                                                                                               | Done?                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2B   | Write this dossier                                                                                                 | ✅                                                                                                                                                                                                                                                                                                                                                                 |
| 2D-1 | Adopt `getOneFrom` / `getManyFrom` across the component layer                                                      | ✅ — 13 files touched, ~14 sites replaced. See _Pass 2D-1 execution notes_ below.                                                                                                                                                                                                                                                                                  |
| 2D-2 | `customQuery` / `customMutation` wrapper                                                                           | ⏳ deferred                                                                                                                                                                                                                                                                                                                                                        |
| 2D-3 | `triggers` + `rowLevelSecurity` + `crud`                                                                           | ⏳ deferred                                                                                                                                                                                                                                                                                                                                                        |
| 3-ζ  | Verify Tier D denormalization drop claims                                                                          | ✅ — 4 of 5 declined as wrong; only D4 (webhook denormalized counters) survived.                                                                                                                                                                                                                                                                                   |
| 3-α  | Tier A mechanical wins (retry merge, oslojs swap, hashString helper, typed `ErrorCode` registry across 124 throws) | ✅ A1/A2/A3/A6. A4/A5/A7 deferred (cascade patterns differ structurally; TTLs and provider IDs are intentionally module-local).                                                                                                                                                                                                                                    |
| 3-γ  | `@convex-dev/action-cache`                                                                                         | ⚠️ Infrastructure in place (component mounted, `component/sso/fetch-cache.ts` with cache wrappers + invalidation mutations). **Call-site swap deferred** — requires threading `ctx` through `discoverOidcConfiguration` → `createGroupConnectionOidcProvider` → `createGroupConnectionOidcRuntime`, all currently pure-config functions. Separate planning needed. |
| 3-β  | `@convex-dev/expiring-table`                                                                                       | ❌ **Component doesn't exist.** `npm view @convex-dev/expiring-table` returns 404. The earlier audit hallucinated this package. The `maintenance.pruneExpired` cron remains the canonical pattern; there is no first-party drop-in to adopt.                                                                                                                       |

## Pass 2D-1 execution notes

After verifying the dossier's "120 sites, 90% replaceable" claim against the real source, the actual replaceable count was much smaller than expected:

- `getOneFrom` / `getManyFrom` only support **single-field** index lookups (`q.eq(field, value)`). Compound-index queries (`q.eq(a, x).eq(b, y)`) are not supported by the helpers and must stay as `.withIndex(...)` chains.
- Most of convex-auth's indexes are compound: `provider_account_id`, `group_id_user_id`, `session_id_first_used`, `connection_id_kind`, `email_status`, `user_code_status`, etc.
- After excluding compound indexes, range queries, and chained `.filter()` / `.order()` / `.paginate()` / `.take()` calls, only ~14 sites across 13 files were genuinely replaceable.

Adopted in **`account.ts`, `session.ts`, `user.ts`, `user/email.ts`, `factor/passkey.ts`, `factor/totp.ts`, `token/refresh.ts`, `token/pkce.ts`, `token/verification.ts`, `group.ts`, `sso/connection.ts`, `sso/connection/domain.ts`, `sso/webhook/endpoint.ts`** — all `.unique()` / `.collect()` patterns on single-field indexes (mostly `user_id` / `connection_id` / `session_id` "list-all-for-foreign-key" reads).

**Skipped** (still using `.withIndex(...)` chains):

- All compound-index sites (most of the codebase).
- All `.first()` calls — replacing with `getOneFrom` would change behavior (`getOneFrom` uses `.unique()` which throws on duplicates; `.first()` doesn't). Conservative choice: don't change runtime semantics.
- Sites chained with `.filter()` / `.order()` / `.paginate()` / `.take()`.

**`nullThrows` was downgraded from "adopt now" → "skip"**: only 2-4 real sites exist; not enough to justify pulling a utility for that volume.

**`corsRouter` was downgraded from "adopt now" → "defer"**: the existing `buildCorsHeaders` in `server/http.ts` is well-factored and not causing bugs; refactor would be stylistic only.

Net result: ~50 LOC saved across 13 files. The win is real but smaller than the original dossier suggested.

## Verdicts at a glance

| Utility                                     | Effort   | Benefit | Verdict                                                                                  |
| ------------------------------------------- | -------- | ------- | ---------------------------------------------------------------------------------------- |
| `getOneFrom` / `getManyFrom` / `getManyVia` | trivial  | medium  | **adopt now** (Pass 2D-1)                                                                |
| `nullThrows`                                | trivial  | low     | **adopt now** (Pass 2D-1)                                                                |
| `corsRouter`                                | trivial  | medium  | **adopt now** (Pass 2D-1)                                                                |
| `customQuery` / `customMutation`            | moderate | medium  | **adopt later** (Pass 2D-2)                                                              |
| `triggers`                                  | large    | high    | **adopt later** (Pass 2D-3)                                                              |
| `rowLevelSecurity`                          | large    | high    | **adopt later** (Pass 2D-3)                                                              |
| `crud`                                      | large    | medium  | **adopt later** (Pass 2D-3)                                                              |
| `retries`                                   | moderate | low     | **decline** (current `retryWithBackoff` is fit-for-purpose, no scheduled-retry need yet) |
| `stream`                                    | large    | low     | **decline** (no multi-source pagination use case in auth)                                |

---

## Adopt now (Pass 2D-1)

### 1. `getOneFrom` / `getManyFrom` / `getManyVia` from `convex-helpers/server/relationships`

**What it does:** type-safe lookup-by-indexed-field that replaces `.query(table).withIndex(idx, q => q.eq(field, value)).first/unique()` boilerplate.

**Landing site:** scattered through `packages/auth/src/server/db.ts` (lines 28–215, 19 indexed lookups) and `packages/auth/src/server/domains/*.ts`. Also in component-side handlers — e.g. `component/user/email.ts:list` handler walks `UserEmail.user_id` via `.withIndex(...).collect()`.

**Effort:** trivial. ~100 LOC over ~5 files. No behavior change.

**Benefit:** less line noise; eliminates the easy class of "I forgot `.unique()` vs `.first()`" mistakes; gives `nullThrows`-style narrowing for free.

---

### 2. `nullThrows` from `convex-helpers` index

**What it does:** `nullThrows(value, message)` — if `value` is `null`/`undefined`, throws a structured error; otherwise narrows to non-null.

**Landing site:** every `if (x === null) throw new ConvexError(...)` pattern across `server/auth.ts`, `server/sso/domain.ts`, `component/group.ts`, etc. Probably ~15–20 sites.

**Effort:** trivial. Find-and-replace.

**Benefit:** consistency of error format; one-liner replaces three-liner; reads better.

---

### 3. `corsRouter` from `convex-helpers/server/cors`

**What it does:** wraps `httpRouter` to add proper CORS preflight handling, configurable per-route.

**Landing site:** `packages/auth/src/server/http.ts` and `packages/auth/src/server/wellknown.ts`. Today these set CORS headers by hand on each route — `Access-Control-Allow-Origin`, preflight `OPTIONS` branches.

**Effort:** trivial (< 50 LOC). Replace the manual header construction with `corsRouter(http, { allowedOrigins: [...] }).route(...)`.

**Benefit:** reduces CORS boilerplate; fewer preflight bugs.

---

## Adopt later (Pass 2D-2 and Pass 2D-3)

### 4. `customQuery` / `customMutation` from `convex-helpers/server/customFunctions` (Pass 2D-2)

**What it does:** lets you build a `query` / `mutation` factory that auto-derives shared context (auth user, session, scoped `db`) and injects it into every handler.

**Landing site:** `packages/auth/src/component/functions.ts` currently bare re-exports `query`/`mutation` from `_generated/server`. A custom wrapper here could pull in things like "load and attach the current user," "load policy state," "wrap the db with RLS rules" so every public function in the component starts from a common ctx.

**Effort:** moderate. The big question is whether component-side functions (which run inside the auth component, not the parent app) actually need this. The parent app's `convex/` is a better candidate.

**Benefit:** centralizes auth derivation; pairs naturally with `rowLevelSecurity` and `triggers` if/when adopted.

**Why "later":** worth doing only after we decide whether to adopt RLS and triggers; doing it standalone moves logic but doesn't shrink it.

---

### 5. `triggers` from `convex-helpers/server/triggers` (Pass 2D-3)

**What it does:** pre/post hooks on `db.insert` / `db.patch` / `db.replace` / `db.delete` with old + new document snapshots.

**Landing site:** SSO mutations now emit stream-backed auth events through
`emitGroupAuthEvent`. A future trigger pass could move some of those event
emits closer to table writes, but webhook delivery is already projected from
auth events instead of a separate audit-row workflow.

**Effort:** moderate to large. Trigger rules need to be written around the
stream event emitter and tests need to verify event ordering stays stable.

**Benefit:** moves lifecycle event emission closer to the writes that cause it.
The old audit + webhook helper machinery is already gone; triggers would mostly
remove remaining explicit `emitGroupAuthEvent` calls from business handlers.

---

### 6. `rowLevelSecurity` from `convex-helpers/server/rowLevelSecurity` (Pass 2D-3)

**What it does:** `wrapDatabaseReader(ctx, db, rules)` / `wrapDatabaseWriter(ctx, db, rules)` enforce per-table read/insert/modify rules.

**Landing site:** `packages/auth/src/server/sso/domain.ts` — connection ownership / group membership checks are written inline at the top of each mutation handler (`requireConnectionMember`, etc.). With RLS, the rules live in one place and `db` enforces them automatically.

**Effort:** large. RLS requires rules for every table the auth component owns
(User, Account, Session, RefreshToken, ApiKey, Passkey, TotpFactor,
GroupMember, GroupInvite, GroupConnection, GroupConnectionDomain,
GroupConnectionSecret, GroupConnectionScimConfig,
GroupConnectionScimIdentity, AuthEventProjection, GroupWebhookEndpoint,
GroupWebhookDelivery, DeviceCode, AuthVerifier, VerificationCode,
OAuthClient, OAuthCode). Each needs a read rule and a write rule.

**Benefit:** prevents the "I forgot the ownership check at the top of this handler" class of bug; centralizes the connection-scoping logic that's currently rewritten in every SSO handler.

**Why "later":** large surface; should be done in concert with `triggers` (they share the wrapped-db plumbing). Probably also after we sort out the SSO connection schema (`hasTotp` deprecation in flight).

---

### 7. `crud` from `convex-helpers/server/crud` (Pass 2D-3)

**What it does:** generates `get`/`list`/`create`/`update`/`delete` functions from a table schema with one call.

**Landing site:** the per-entity component files (`component/user.ts`, `component/session.ts`, etc.) all follow a near-identical CRUD shape. The plumbing is exactly what `crud` generates.

**Effort:** large. Each file replaces ~120 LOC of handlers with ~10 LOC of generator config. But: convex-auth's CRUD handlers do non-trivial work (cascade-delete for user.delete with `cascade: true`, denormalized email/phone sync for user.upsert, etc.). The generator output is for _plain_ CRUD only; we'd still need custom handlers for those.

**Benefit:** ~300 LOC saved across ~10 files. But the generator only fits the truly plain entities (`oauth.client`, `factor.totp`, maybe `account`). Mixed adoption is awkward.

**Why "later":** the win is real but partial. Better to wait until we know which entities can really be plain CRUD vs which need custom logic.

---

## Decline

### `retries` — current `server/utils/retry.ts:retryWithBackoff` is sufficient

It's used for external HTTP fetches in `sso/oidc.ts`. convex-helpers' `makeActionRetrier` provides _stateful_ retry tracking (persists job state in a table) which is overkill for inline retries.

### `stream` — adopted for auth events

Auth lifecycle, SSO/SCIM audit, and webhook source events now use
`@convex-dev/stream` plus `AuthEventProjection` for Convex-native reads.
`GroupWebhookDelivery` remains as the retry/projection layer for outbound HTTP
delivery.

## Convex platform features

Quick scan of `convex/server` and `convex/react` exports:

- **`cronJobs`** — auth doesn't use Convex cron today. Candidates:
  - daily cleanup of expired refresh tokens (currently relies on `maintenance.pruneExpired` being wired into the consumer app's cron)
  - retry of failed webhook deliveries
  - Lower priority; the maintenance function already exists, just needs documentation.

- **`preloadQuery` / `usePreloadedQuery` / `useSuspenseQuery`** — not used anywhere. This is the SSR/Suspense gap flagged in the earlier audit (Pass 3 — deferred). When we do tackle SSR, these are the primitives we adopt.

- **No new symbols** in `convex/values` or `convex/server` exports that I see we're missing. Argument validators (`v.id`, `v.union`, `v.object`, `v.optional`) all already in use.

---

## Adoption sequence

Sequencing matters because some items depend on others:

1. **Pass 2D-1**: `getOneFrom` + `nullThrows` + `corsRouter`. Independent, mechanical, < 1 day each.
2. **Pass 2D-2**: `customQuery` / `customMutation` wrapper in `component/functions.ts`. Sets up the plumbing for Pass 2D-3.
3. **Pass 2D-3**: `triggers` + `rowLevelSecurity` + `crud`. Larger refactor that benefits from the customFunctions plumbing being in place first.

Pass 2D-1 can start any time. Pass 2D-2 and 2D-3 are deferred until a separate planning pass.
