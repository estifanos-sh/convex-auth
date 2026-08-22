---
title: auth.event.list for SSO audit
description: Stream-backed SSO audit event projection queries.
---

<svelte:head>

  <title>auth.event.list for SSO audit - convex-auth</title>
</svelte:head>

# auth.event.list for SSO audit

SSO audit views read canonical event projections through `auth.event.list`.
Each event kind belongs to one library-owned category; callers name the kind and
convex-auth derives that category, so filters cannot drift from the taxonomy.
The component appends every event to one private, append-only `auth-events`
stream ordered by Convex commit time, then exposes redacted projections for
application reads. Stream cursors are deliberately not part of this API.

An `eventId` makes a retried emission idempotent. Reusing it does not append a
second stream record or duplicate an existing target projection.

App-owned admin RPC may wrap `auth.connection.audit.list` for convenience, but
the canonical server facade is `auth.event.list(ctx, { where, paginationOpts })`.

## Methods

| Method | Signature                                                                | Returns                                  | Description                       |
| ------ | ------------------------------------------------------------------------ | ---------------------------------------- | --------------------------------- |
| `list` | `(ctx, { where: (q) => q.eq("target", scope), paginationOpts, order? })` | `{ page, isDone, continueCursor }` event | Lists redacted event projections. |

## Example

### Query audit logs

```ts
import { auth, authEvents } from "./auth";

const connectionLogs = await auth.event.list(ctx, {
  where: (q) => q.eq("target", authEvents.target.connection(connectionId)),
  paginationOpts: { numItems: 50, cursor: null },
});

const failedSsoLogins = await auth.event.list(ctx, {
  where: (q) =>
    q
      .eq("target", authEvents.target.connection(connectionId))
      .eq("kind", authEvents.connection.loginFailed)
      .eq("outcome", "failure"),
  order: "desc",
  paginationOpts: { numItems: 50, cursor: null },
});
```
