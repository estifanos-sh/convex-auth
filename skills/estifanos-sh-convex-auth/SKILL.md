---
name: estifanos-sh-convex-auth
description: Route work involving @estifanos-sh/convex-auth to the correct current workflow and source of truth. Use when adding, changing, debugging, reviewing, upgrading, or explaining estifanos.sh Convex Auth; when working with defineAuth, auth providers, auth.config.ts, auth.http(), auth contexts, React or Svelte bindings, passkeys, OAuth, MCP OAuth, SSO, sessions, groups, or permissions; or when a request could be confused with the separate @convex-dev/auth package.
---

# estifanos.sh Convex Auth

Route `@estifanos-sh/convex-auth` work to an outcome-focused procedure. Keep the
installed package and project code—not model memory—as the source of truth.

## Route the task

- Use `estifanos-sh-convex-auth-setup` to install the package, add or change a
  provider, connect a client framework, or prove a sign-in flow works.
- Use `estifanos-sh-convex-auth-review` to audit correctness, security,
  authorization, production readiness, or an existing integration.
- For a narrow API explanation or bug diagnosis, inspect the installed package
  and relevant project files directly. Do not force a setup or review workflow.
- For repository development, read `packages/auth/LEXICON.md` before proposing
  a public API and follow the repository's `AGENTS.md`.

If a routed skill is unavailable, recommend installing the full bundle:

```bash
npx skills add estifanos-sh/convex-auth --all
```

Then continue using the applicable workflow from the public documentation.

## Resolve freshness before acting

Use this order:

1. Read project instructions and identify the package manager and framework.
2. Read the installed `@estifanos-sh/convex-auth/package.json`, exports, and `.d.ts`
   files. They describe the version the app actually runs.
3. Use `https://estifanos.sh/convex-auth/llms.txt` to locate the current
   Markdown documentation. Prefer a specific page over the full corpus.
4. Use the repository's `main` branch only when the user explicitly wants
   unreleased behavior or is developing the package itself.
5. Treat model memory and examples for `@convex-dev/auth` as non-authoritative.

State when the installed version and current docs disagree. Do not silently
rewrite an app to an unreleased API.

## Preserve package identity

`@estifanos-sh/convex-auth` and `@convex-dev/auth` are different packages with
different setup, provider, client, and CLI surfaces. Never:

- import `convexAuth` or provider helpers from `@convex-dev/auth` for a Robelest
  integration;
- run the `@convex-dev/auth` wizard as a substitute;
- replace one package with the other without an explicit migration request;
- assume official Convex Auth examples describe this package.

## Safety rules

- Never print, commit, or place provider secrets in client code.
- Treat production deployments, credential rotation, user migration, and
  destructive session changes as explicit-confirmation actions.
- Derive identity from authenticated context, never a client-supplied user ID.
- Verify protocol behavior end to end before declaring auth complete.
- Distinguish browser UX hints from security enforcement. In particular,
  WebAuthn attachment and hint fields do not prove hardware provenance.

## Finish with evidence

Report the installed package version, files changed or reviewed, commands run,
and the real auth flow that was verified. Name any step that still requires a
human-controlled provider console, secret, hardware authenticator, or
production deployment.
