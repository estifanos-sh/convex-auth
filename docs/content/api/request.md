---
title: auth.request
description: Mount auth protocol routes and authenticate application-owned HTTP actions.
---

`auth.request` is the HTTP boundary for Convex Auth. It mounts protocol routes,
resolves session, API-key, and OAuth bearer authentication for raw requests,
and registers application-owned authenticated HTTP and MCP endpoints.

Use `auth.http()` for the ordinary setup. It creates one Convex HTTP router and
mounts every configured auth route:

```ts
// convex/http.ts
import { auth } from "./auth";

export default auth.http();
```

## Methods

| Method    | Signature                 | Description                                                                  |
| --------- | ------------------------- | ---------------------------------------------------------------------------- |
| `mount`   | `(http)`                  | Adds every configured auth protocol route to an existing Convex HTTP router. |
| `routes`  | `()`                      | Returns stable Convex `RouteSpec[]` descriptors for router adapters.         |
| `context` | `(ctx, request, config?)` | Resolves a required session, API-key, or OAuth auth context.                 |
| `action`  | `(handler, options?)`     | Creates a Bearer API-key-authenticated HTTP action.                          |
| `route`   | `(http, routeConfig)`     | Registers an API-key-authenticated route and its CORS preflight.             |
| `mcp`     | `(http, tools, options?)` | Mounts an OAuth-protected MCP server using configured grants as scopes.      |

`auth.request.context.optional(ctx, request, config?)` returns the same stable
shape with `userId: null` when no authentication source resolves.

## Add auth routes to an existing router

Use `mount` when the application already owns its HTTP router:

```ts
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();
auth.request.mount(http);

export default http;
```

## Route descriptors for adapters

`routes()` exists for router integrations that accept Convex route descriptors
instead of a router instance. Preserve each descriptor's typed handler:

```ts
import { httpRouter } from "convex/server";

const http = httpRouter();
for (const route of auth.request.routes()) {
  http.route(route);
}

export default http;
```

Do not cast the handler to an object with private invocation methods such as
`invokeHttpAction`. A `RouteSpec` handler is a Convex function reference, not a
callback for application code to invoke. If an adapter needs to run logic
before every auth route, apply that logic at the router or hosting boundary, or
use `mount` directly.

## Resolve mixed HTTP authentication

Use `context` for a raw HTTP action that accepts browser sessions, API keys, or
OAuth access tokens:

```ts
const handler = httpAction(async (ctx, request) => {
  const identity = await auth.request.context(ctx, request);

  return Response.json({
    userId: identity.userId,
    source: identity.source,
  });
});
```

The result discriminates `source` as `"session"`, `"key"`, or `"oauth"` and
includes source-specific metadata. Pass `config.resource` when an OAuth route
must enforce an RFC 8707 resource indicator.

## API-key routes

`action` wraps one handler. `route` additionally registers the route and its
`OPTIONS` preflight. Both can require a scope and expose verified key metadata
as `ctx.key`:

```ts
auth.request.route(http, {
  path: "/api/messages",
  method: "POST",
  scope: { resource: "messages", action: "create" },
  handler: async (ctx, request) => {
    const body = await request.json();
    await ctx.runMutation(internal.messages.create, {
      userId: ctx.key.userId,
      body,
    });
    return { ok: true };
  },
});
```

For OAuth-protected MCP tools, use `auth.request.mcp`; see the
[MCP server guide](/guides/mcp-server).
