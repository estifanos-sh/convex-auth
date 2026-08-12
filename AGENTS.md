# AGENTS.md — Coding Agent Guidelines for convex-auth

> **Read [`packages/auth/LEXICON.md`](packages/auth/LEXICON.md) before adding any new public API.** It is the authoritative naming and shape contract: verbs, arg shapes, validator names, file paths, pagination discipline, function visibility. Deviating from it requires written justification in the PR.

## Project Overview

Monorepo for `@estifanos-sh/convex-auth` — a Convex authentication library. Uses
**pnpm** workspaces and **Vite+** (`vp`) as the top-level workflow tool with ESM
(`"type": "module"`) throughout.

| Package            | Purpose                                                         |
| ------------------ | --------------------------------------------------------------- |
| `packages/auth`    | Core library (server, client, providers, CLI, Convex component) |
| `tests/`           | Vitest test suite (convex, node, and samlify projects)          |
| `packages/samlify` | Local SAML runtime fork used for group SSO work                 |
| `convex/`          | App-level Convex backend functions                              |

## Build / Lint / Test Commands

All commands run from the **repo root** unless noted.

```bash
# Build the auth library and refresh component codegen
vp run build

# Lint / format / checks (entire monorepo)
vp run lint
vp run fmt
vp run check

# Run all tests once (CI-style)
vp run test

# Run convex + node tests in watch mode
vp test --project convex --project node

# Run Docker-backed interop tests
vp test --project interop

# Run a single test project
vp test --run --project convex

# Generate Convex types (app + component)
vp run codegen:convex
```

### Build Sub-steps (packages/auth)

The library builds in four stages:

1. `build:version` — generates `src/server/version.ts` from `package.json`
2. `build:bin` — tsdown bundles CLI to `dist/bin.js`
3. `build:server` — tsc with `tsconfig.server.json` (server + providers)
4. `build:client` — tsc with `tsconfig.client.json` (client + error types)
5. `build:component` — tsc with `tsconfig.component.json` (Convex component)

## TypeScript Configuration

- **`strict: true`** in all tsconfigs — do not weaken.
- `target: "ESNext"`, `module: "ESNext"` for the auth package.
- `moduleResolution: "bundler"` in all packages.
- `declaration: true`, `declarationMap: true`, `sourceMap: true` for the auth
  package.
- `stripInternal: true` on server build — use `@internal` JSDoc to hide from
  public types.

## Code Style

### Formatting (Prettier)

Root config is minimal: `{ "proseWrap": "always" }`. Defaults apply:

- Double quotes, semicolons, 2-space indentation, default trailing commas.

### Imports

- **ES module imports only** (`import { X } from "module"`).
- **No `.js` extensions** on relative imports (e.g.,
  `import { foo } from "./utils"`).
- Separate **type-only imports**: `import type { Foo } from "module"`.
- Order: third-party imports first, then relative imports.
- Re-exports: `export { X } from "module"` and
  `export type { X } from "module"`.

### Naming Conventions

| Element           | Convention         | Examples                                |
| ----------------- | ------------------ | --------------------------------------- |
| Files             | one-word lowercase | `signin.ts`, `cookies.ts`, `codes.ts`   |
| Functions         | `camelCase`        | `signIn`, `parseAuthCookies`            |
| Classes           | `PascalCase`       | `Auth`                                  |
| Types/Interfaces  | `PascalCase`       | `AuthCookies`, `ConvexAuthConfig`       |
| Constants         | `UPPER_SNAKE_CASE` | `JWT_DEFAULT_EXPIRY`, `DEFAULT_MAX_AGE` |
| Unused params     | `_` prefix         | `_ctx`, `_args`                         |
| Private fields    | `_` prefix         | `_auth`                                 |
| Provider defaults | lowercase function | `export default function password()`    |

**File naming rule:** every source filename is a single lowercase word — no
hyphens, no `camelCase`. Multi-concept names become nested directories:
`auth-code.ts` → `auth/code.ts`, `error-codes.ts` → `shared/codes.ts`,
`xml-builder.ts` → `xml/builder.ts`. Avoid `index.ts` barrel files — prefer
a descriptively-named file (e.g. `meta.ts`, `entity.ts`). `.tsx` is allowed
where JSX requires it, e.g. `react/index.tsx`.

### Error Handling

The project uses a **structured error system** built on `ConvexError` and a
typed `ErrorCode` registry:

```typescript
import { toConvexError } from "./server/errors";
import type { AuthErrorData } from "./server/errors";
import { ErrorCode } from "./shared/codes";

// Throw a structured ConvexError at a handler boundary
throw new ConvexError<AuthErrorData>({
  code: ErrorCode.NOT_SIGNED_IN,
  message: "You must be signed in.",
});

// Normalize an unknown error into ConvexError<AuthErrorData>
throw toConvexError(caughtError);

// Internal flow control — caught within the server layer, not user-facing
import { authFlowError } from "./shared/errors";
throw authFlowError(ErrorCode.EMAIL_SEND_FAILED, "Custom message");
```

- `toConvexError` and `AuthErrorData` live in `server/errors.ts`.
- `AuthFlowError` / `authFlowError` live in `shared/errors.ts`.
- `ErrorCode` registry lives in `shared/codes.ts` — always use `ErrorCode.<NAME>`
  over inline string literals so typos are caught at compile time.
- Use `try/catch` with `console.error` for non-fatal issues (token refresh, etc.).
- Silent `catch {}` is acceptable for cleanup operations (sign-out, storage deletion).
- Provider validation errors can use plain `throw new Error("message")`.

### CRUD Verb Conventions

Entity methods follow a standard verb set:

| Operation   | Verb     | Notes                                     |
| ----------- | -------- | ----------------------------------------- |
| Create      | `create` | Always `create`, not `add`                |
| Read one    | `get`    | Positional ID: `auth.user.get(ctx, id)`   |
| Read many   | `list`   | Options object: `auth.user.list(ctx, {})` |
| Update      | `update` | Always `update`, not `patch`              |
| Hard delete | `delete` | Permanent removal                         |
| Soft delete | `revoke` | Status change (keys, invites)             |

Parameter shape rule: single-ID lookups use positional args; multi-field inputs
use options objects.

### Exports & Architecture Patterns

- **Factory functions over classes**: prefer `function createThing(opts)`
  returning an object over `class Thing`. This enables Convex bundler
  tree-shaking via `export const { x, y } = factory(config)`.
- **Barrel files**: package-entry barrels use `index.ts` (the package `exports` map points at stable `index.ts` paths); internal re-export barrels use a descriptively-named file (e.g. `mutations/calls.ts`), per the naming rule above.
- **Named exports** for most things; **default exports** only for provider
  functions.
- Use `as const satisfies Record<K, V>` for exhaustive typed constant maps.
- Derive types from constants: `type Code = keyof typeof AUTH_ERRORS`.

### TypeScript Patterns

- `any` is allowed (ESLint `no-explicit-any` is off) — use it for Convex context
  objects and dynamic provider types where strict typing is impractical.
- Function overloads for different auth modes (optional vs required user).
- Generics with Convex data model: `<DataModel extends GenericDataModel>`.
- `void` prefix for fire-and-forget promises: `void refreshToken()`.
- SSR guards: `typeof window !== "undefined"`.
- Discriminated unions for state management.

### Script Sources

- Write authored scripts in TypeScript and execute them directly with Node 24.
- Do not add `.js` or `.mjs` source files. Framework configuration files may
  keep a JavaScript filename only when their loader requires that convention;
  `vp run check:sources` owns the explicit exception list.

### JSDoc

- Add `/** JSDoc */` with `@param`, `@returns`, `@example` on all **public API**
  functions.
- Use `@internal` to exclude from generated `.d.ts` files (server build uses
  `stripInternal`).
- Use `@module` at the top of entry-point files.

## Testing Conventions

- **Framework**: Vitest + convex-test + edge-runtime environment.
- Tests live under `tests/` (root feature tests and `tests/group/*.test.ts`).
- Use `test()` directly (no `describe()` blocks).
- Each test creates an isolated environment via `convexTest(schema)`.
- Call Convex functions: `t.action(api.auth.signIn, { ... })`.
- Simulate identity: `t.withIdentity({ subject: claims.sub })`.
- Error assertions: `expect(...).rejects.toThrow("expected message")`.
- Use `test.todo("...")` for planned tests.
- Mock fetch via `vi.stubGlobal("fetch", ...)` + cleanup with
  `vi.unstubAllGlobals()`.
- Setup env per test with `setupEnv()` — sets `process.env` inline, no shared
  `beforeEach`.
- Test timeout: 10 seconds (configured in `vite.config.ts`).

## ESLint Notes

- ESLint 9 flat config at repo root (`eslint.config.mjs`).
- `no-only-tests/no-only-tests: "warn"` — never commit `.only` tests.
- `@typescript-eslint/no-unused-vars: "warn"` — prefix unused vars with `_`.
- `@convex-dev/eslint-plugin` rules apply to `convex/**` and
  `packages/auth/src/component/**`.
- Auto-generated files are ignored: `convex/_generated/**`, `**/dist/**`,
  `**/*.d.ts`.

## Package Manager

- **pnpm via Vite+** — use `vp install`, `vp run`, and `vp exec` as the normal
  workflow surface. Do not use npm/yarn/bun directly for package management.
- Workspace protocol: `"workspace:*"` for local deps.
- Catalog versions: `"catalog:"` in sub-packages resolve from
  `pnpm-workspace.yaml`.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
