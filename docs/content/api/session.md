---
title: auth.session
description: Session management — read, list, and revoke sessions.
---

The `auth.session` namespace manages signed-in browser and device sessions.
Revocation advances a user-owned session epoch before any physical cleanup. A
revoked access token therefore fails the next auth-context resolution and its
refresh token cannot mint another token, even when an expired row has not been
removed yet.

Protected functions validate that epoch in the same component query that reads
the current user and active-group authorization state. Applications should use
`auth.ctx()` or `auth.context(ctx)` instead of separately loading the viewer,
active group, and membership; those extra calls repeat the same component reads
without making authorization fresher.

The `ctx.auth` examples on this page assume the handler uses `auth.ctx()`-backed
builders such as `authQuery`, `authMutation`, or `authAction`. The resolver
validates the session while loading one component snapshot of the current user,
active group, membership, role, and grants. Reuse it instead of loading those
records again.

`id(ctx)` reads the current session ID from the trusted identity claims without
a database read. It returns a branded `Id<"Session">` or `null`, which can be
passed directly to the other session methods.

```ts
const sessionId = await auth.session.id(ctx); // Id<"Session"> | null
```

`revoke(ctx, { userId, except? })` signs a user out by advancing the session
epoch. For “sign out everywhere else,” retain the current branded session ID.
The retained session moves to the new epoch in the same mutation, while every
other access and refresh token stops working immediately. Physical row cleanup
may happen later; it is never the security boundary.

```ts
const sessionId = await auth.session.id(ctx);
if (!sessionId) {
  throw new Error("Current session missing");
}

await auth.session.revoke(ctx, {
  userId: ctx.auth.userId,
  except: [sessionId],
});
```

`get(ctx, { id })` reads one session document. `list(ctx, { userId })` returns
at most 16 sessions from the user's current epoch. Each row includes its
absolute `expirationTime`; a current-devices UI compares that field with its
own clock. The component query deliberately does not read wall-clock time,
because a cached Convex query does not become invalid merely because time has
passed.

```ts
const sessions = await auth.session.list(ctx, { userId: ctx.auth.userId });
```

Session storage, refresh tokens, handoff state, and restricted enrollment state
belong to Convex Auth. An application should not mirror sessions in its own
table or parse identity claims to manufacture component IDs. For tests, use
`createAuthTest(...).session.create({ userId })`; it creates a real component
session and returns the correctly branded ID and `t.withIdentity` claims.
