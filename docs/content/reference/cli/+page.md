---
title: CLI Reference
description: Command-line commands and options for the setup wizard.
---

<svelte:head>

  <title>CLI Reference - convex-auth</title>
</svelte:head>

# CLI Reference

## Commands

```bash
npx convex-auth [command] [options]
```

The CLI defaults to `setup` when no command is given.

| Command  | Description                                                    |
| -------- | -------------------------------------------------------------- |
| `setup`  | Scaffold files and set environment variables (default).        |
| `doctor` | Verify env vars, files, and mounted auth endpoints.            |
| `urls`   | Print auth endpoint and provider callback URLs.                |
| `keys`   | Generate signing/encryption keys and set them on a deployment. |

## Setup wizard

```bash
npx convex-auth [options]
```

The wizard configures `APP_URL`, generates signing and encryption keys, updates
`tsconfig.json`, and creates `convex.config.ts`, `auth.ts`, `http.ts`, and
`auth.config.ts`. `auth.ts` is the only application auth module: it configures
providers, exports the client actions, and supplies the server facade used by
protected functions.

The CLI reads the typed `CONVEX_DEPLOYMENT` value written by Convex, such as
`dev:my-deployment`, `prod:my-deployment`, or `preview:my-deployment`, when no
target flag is supplied. For an explicit `--deployment`, use Convex's canonical
selector vocabulary: a deployment name such as `my-deployment`, a reference
such as `dev/alice`, `dev`, `prod`, or `local`, or a qualified
`project-slug:reference` / `team-slug:project-slug:reference` selector.

Selectors such as `dev` or `dev/alice` identify a deployment through the Convex
CLI but do not contain its HTTP-actions hostname. Pass `--site-url` when
`doctor` or `urls` cannot derive that hostname. Use `--url` for an explicit
deployment URL or a self-hosted target.

## Options

| Option                    | Description                                               |
| ------------------------- | --------------------------------------------------------- |
| `--app-url <url>`         | Value for `APP_URL`; avoids interactive prompt            |
| `--prod`                  | Target production deployment                              |
| `--deployment <selector>` | Target a named deployment or Convex deployment selector   |
| `--url <url>`             | Target deployment by explicit URL or self-hosted endpoint |
| `--site-url <url>`        | Set the HTTP actions URL when it cannot be derived        |
| `--admin-key <key>`       | Use explicit admin key (typed for Convex Cloud)           |
| `--variables <json>`      | Additional variables for configuration                    |
| `--skip-git-check`        | Skip the "outside Git repo" warning                       |
| `--allow-dirty-git-state` | Skip all source-control checks                            |

## Group Connection API

Group SSO RPC is app-owned. Create a single file like `convex/auth/group.ts` and
export only the helpers your app needs:

```ts
import { v } from "convex/values";
import { authMutation } from "./functions";
import { auth } from "../auth";
import { roles } from "../roles";

// Expose only the helpers your app needs — the same authMutation/authQuery
// pattern as the rest of your app. Authorize with auth.member.assert, then
// call the flat auth.connection.* facade.
export const createConnection = authMutation({
  args: {
    groupId: auth.v.id("Group"),
    protocol: v.union(v.literal("oidc"), v.literal("saml")),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await auth.member.assert(ctx, {
      userId: ctx.auth.userId,
      groupId: args.groupId,
      roleIds: [roles.orgAdmin.id],
    });
    return auth.connection.create(ctx, args);
  },
});

export const setScim = authMutation({
  args: { connectionId: auth.v.id("GroupConnection") },
  handler: async (ctx, args) => {
    const connection = await auth.connection.get(ctx, { id: args.connectionId });
    if (connection === null) throw new Error("Connection not found.");
    await auth.member.assert(ctx, {
      userId: ctx.auth.userId,
      groupId: connection.groupId,
      roleIds: [roles.orgAdmin.id],
    });
    return auth.connection.scim.upsert(ctx, args);
  },
});
```

Example:

```bash
npx convex-auth --app-url "https://app.example.com"
```

Then call the exported functions with normal Convex hooks:

```ts
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";

const createConnection = useMutation(api.auth.group.createConnection);
const setScim = useMutation(api.auth.group.setScim);
```

Pass a concrete `groupId` when calling `createConnection(...)`.

## Agent Skills

Install the portable setup and review workflows with the standard Agent Skills
installer:

```bash
npx skills add estifanos-sh/convex-auth --all
```

The package CLI prints this command after setup but does not install or update
agent-specific files implicitly. See [Agent Skills](/ai/agent-skills/) for the
available workflows.
