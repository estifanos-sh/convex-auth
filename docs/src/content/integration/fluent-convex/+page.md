---
title: Fluent Convex
description: Optional app-side middleware patterns with fluent-convex.
---

<script>
  import Tabs from '$lib/components/docs/Tabs.svelte';
  import TabItem from '$lib/components/docs/TabItem.svelte';
</script>

<svelte:head>

  <title>Fluent Convex - convex-auth</title>
</svelte:head>

# Fluent Convex

This is an optional pattern for apps that want app-side Convex middleware on top
of the minimal auth setup. You do not need this to use `convex-auth`.

If you do want custom app helpers,
[`fluent-convex`](https://www.npmjs.com/package/fluent-convex) keeps auth
middleware concise and explicit.

<Tabs syncKey="pkg">
  <TabItem label="npm">

```bash
npm install fluent-convex zod
```

  </TabItem>
  <TabItem label="pnpm">

```bash
pnpm add fluent-convex zod
```

  </TabItem>
  <TabItem label="yarn">

```bash
yarn add fluent-convex zod
```

  </TabItem>
</Tabs>

## Setup

```ts
// convex/lib/functions.ts
import { createBuilder } from "fluent-convex";
import { WithZod } from "fluent-convex/zod";
import type { DataModel } from "./_generated/dataModel";
import { auth } from "../auth";

const convex = createBuilder<DataModel>();

// auth.context() resolves { userId, user, groupId, role, grants }
// and throws ConvexError if unauthenticated.
const withRequiredAuth = convex.createMiddleware(async (ctx, next) => {
  return next({ ...ctx, auth: await auth.context(ctx) });
});

export const query = convex.query().use(withRequiredAuth).extend(WithZod);
export const mutation = convex.mutation().use(withRequiredAuth).extend(WithZod);
export const internalMutation = convex.mutation().extend(WithZod);
```

## Usage

```ts
// convex/chat.ts
import { z } from "zod/v4";
import { mutation } from "./lib/functions";

export const send = mutation
  .input(z.object({ body: z.string().trim().min(1) }))
  .handler(async (ctx, { body }) => {
    await ctx.db.insert("messages", { body, userId: ctx.auth.userId });
    return null;
  })
  .public();
```

This is app-specific code. The canonical `convex-auth` setup only needs:

- `convex/convex.config.ts`
- `convex/auth.ts`
- `convex/auth.config.ts`
- `convex/http.ts`
