---
title: Agent Skills
description: Install focused convex-auth workflows for AI coding agents.
---

<svelte:head>

  <title>Agent Skills - convex-auth</title>
</svelte:head>

{/_ cspell:ignore llms _/}

# Agent Skills

Install the first-party `@estifanos-sh/convex-auth` skills to give a coding agent
current setup and security-review workflows without loading the entire
documentation site into every conversation.

## Install

Choose individual skills interactively:

```bash
npx skills add estifanos-sh/convex-auth
```

Or install the complete bundle:

```bash
npx skills add estifanos-sh/convex-auth --all
```

The standard installer places portable skills in `.agents/skills/`. Compatible
agents discover them automatically.

## Available skills

| Skill                             | Use it for                                                        |
| --------------------------------- | ----------------------------------------------------------------- |
| `estifanos-sh-convex-auth`        | Route a task and distinguish this package from `@convex-dev/auth` |
| `estifanos-sh-convex-auth-setup`  | Install, add providers, connect a framework, and verify sign-in   |
| `estifanos-sh-convex-auth-review` | Audit security, correctness, protocol behavior, and launch safety |

Skills trigger automatically when an agent recognizes the task. Invoke one
explicitly with `/estifanos-sh-convex-auth-setup` in Claude Code, Cursor, and GitHub
Copilot, or `$estifanos-sh-convex-auth-setup` in Codex.

## Ask for an outcome

Good requests describe the result and constraints:

```text
Add @estifanos-sh/convex-auth with GitHub sign-in to this SvelteKit app. Preserve
the existing Convex client, use the current package API, and verify sign-in and
sign-out in the browser.
```

```text
Review this @estifanos-sh/convex-auth integration for cross-tenant access,
session-refresh races, OAuth callback mistakes, and WebAuthn trust-policy gaps.
Report findings with file and line evidence before changing code.
```

The skills read the installed package version and public types before using
online guidance. This prevents a current skill from silently applying an
unreleased API to an older application.

## Machine-readable documentation

- [`/llms.txt`](/llms.txt) is the compact index with one Markdown URL per page.
- [`/llms-full.txt`](/llms-full.txt) contains the full documentation corpus.
- Append `.md` to a documentation route for its canonical Markdown, for example
  [`/getting-started/installation.md`](/getting-started/installation.md).

Skills contain procedures and guardrails. Detailed API reference remains in
the documentation so agents load it only when the task requires it.
