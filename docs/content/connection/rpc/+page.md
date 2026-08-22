---
title: Group SSO RPC
description: Expose the smallest authorized group SSO surface your application needs.
---

<svelte:head>

  <title>Group SSO RPC</title>
</svelte:head>

# Group SSO RPC

`auth.connection.*` is a server facade, not a browser API. It gives trusted
Convex functions the primitives for configuring enterprise connections without
automatically exposing tenant administration to every client. This distinction
is intentional: Convex Auth owns the protocol state, while your application
owns the decision about which group administrator may change it.

Most applications do not need a group SSO RPC surface. Normal sign-in and
sign-out use `api.auth.signIn` and `api.auth.signOut`. Add app-owned connection
functions only when the product includes an administration interface for OIDC,
SAML, SCIM, domains, policies, or webhooks.

## Expose product operations, not the entire facade

Create a function for the action your UI performs and authorize it in that
function. Do not mechanically mirror every `auth.connection` method into a
large `api.auth.group` namespace. A smaller public surface is easier to secure,
easier to change, and usually requires less client code.

```ts
// convex/auth/group.ts
import { v } from "convex/values";
import { auth } from "../auth";
import { authMutation } from "../functions";

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
      grants: ["connection.create"],
    });

    return auth.connection.create(ctx, args);
  },
});
```

The authenticated builder establishes who is calling. `member.assert` then
checks whether that user may administer the selected group. The facade performs
the connection write inside Convex Auth. No app-owned connection table or sync
layer is needed.

Operations on an existing connection should load it first, derive its trusted
`groupId`, and authorize against that group. Do not accept a separate group ID
from the client and assume it belongs to the connection.

```ts
export const updateConnection = authMutation({
  args: {
    id: auth.v.id("GroupConnection"),
    patch: v.object({ name: v.optional(v.string()) }),
  },
  handler: async (ctx, args) => {
    const connection = await auth.connection.get(ctx, { id: args.id });
    if (!connection) throw new Error("Connection not found");

    await auth.member.assert(ctx, {
      userId: ctx.auth.userId,
      groupId: connection.groupId,
      grants: ["connection.update"],
    });

    return auth.connection.update(ctx, args);
  },
});
```

This follows the public lexicon: selectors use object arguments such as
`{ id }`, `update` receives `{ id, patch }`, and permanent deletion is
`remove`. Keep those names in app wrappers unless the product operation has a
genuinely different meaning.

## Protocol configuration

OIDC, SAML, and SCIM describe how Convex Auth reads identity from an external
system. Connection policy describes what Convex Auth should do with that
identity: whether an account may link, whether a user or membership may be
created just in time, which profile source is authoritative, and what
deprovisioning means.

Keep those concerns separate in the UI and in server functions. A protocol
configuration mutation should call the corresponding
`auth.connection.oidc`, `auth.connection.saml`, or `auth.connection.scim`
facade after checking a protocol-management grant. A policy mutation should
call `auth.connection.policy` after checking a policy-management grant. This
separation prevents a connection editor from accidentally changing account
provisioning rules as a side effect.

SAML metadata retrieval and other network-bound operations belong in an
`authAction`. Database reads belong in `authQuery`, and database writes belong
in `authMutation`. The builder communicates runtime behavior and ensures the
same auth context is present in each handler.

## Pre-sign-in discovery

Connection discovery is one of the few group SSO operations that may be public.
A user cannot already have a session if the purpose of the request is to decide
which SSO connection should authenticate them. Expose only the facade's
discovery result, using an email domain or a connection identifier, and avoid
returning secrets or full administrative configuration.

Metadata needed by an identity provider can also be public because it is a
protocol document, not an administrative capability. Keep configuration writes
behind authenticated grant checks even when the corresponding metadata read is
public.

## Client code remains ordinary Convex code

Once an app exports one of these functions, the generated Convex API exposes it
like any other query, mutation, or action. The client does not need a second SSO
SDK or a copy of the server facade.

```ts
const createConnection = useMutation(api.auth.group.createConnection);

await createConnection({
  groupId,
  protocol: "oidc",
  name: "Company identity provider",
});
```

The goal is not to recreate Convex Auth's enterprise API at the application
layer. The goal is to expose the few product operations an administrator can
actually perform, authorize each one with a typed grant, and let Convex Auth own
the underlying protocol state.
