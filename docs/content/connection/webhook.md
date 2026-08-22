---
title: auth.connection.webhook
description: SSO webhooks — manage group webhook endpoints.
---

The `auth.connection.webhook` namespace manages group webhook endpoints for
SSO-related events.

> This page documents the **server-side helper API**:
> [`auth.connection.webhook.*`](/connection/webhook/). Client-callable admin RPC like
> `api.auth.group.createWebhookEndpoint` only exists after you expose it
> yourself — write an `authMutation` that authorizes with `auth.member.assert`
> and forwards to this facade, the same pattern as the rest of your app.

## Endpoint methods

| Method            | Signature                                                               | Returns          | Description                                                                               |
| ----------------- | ----------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `endpoint.create` | `(ctx, { connectionId, url, secret, subscriptions, createdByUserId? })` | `{ endpointId }` | Creates a webhook endpoint that listens for specific events.                              |
| `endpoint.list`   | `(ctx, { connectionId })`                                               | Endpoint[]       | Lists all webhook endpoints for a connection.                                             |
| `endpoint.update` | `(ctx, { id, patch: { url?, status?, secret?, subscriptions? } })`      | `{ endpointId }` | Updates an endpoint and optionally rotates its signing secret.                            |
| `endpoint.revoke` | `(ctx, { id })`                                                         | `{ endpointId }` | Disables a webhook endpoint (stops delivery). Throws `ConvexError` if endpoint not found. |

## Example

### Set up a webhook endpoint

```ts
const { endpointId } = await auth.connection.webhook.endpoint.create(ctx, {
  connectionId,
  url: "https://api.acme.com/webhooks/sso",
  subscriptions: [authEvents.connection.oidcSet.id, authEvents.scim.set.id],
  secret: "whsec_...",
});
```

### Disable an endpoint

```ts
await auth.connection.webhook.endpoint.revoke(ctx, { id: endpointId });
```

### Rotate a secret

```ts
await auth.connection.webhook.endpoint.update(ctx, {
  id: endpointId,
  patch: {
    secret: "whsec_new_...",
    status: "active",
  },
});
```

Endpoint reads never return `secretCiphertext`; signing material stays inside
the component.

## Delivery worker

When the lib emits an event for an active endpoint subscribed to that event
type, it inserts a `GroupWebhookDelivery` row **and enqueues an HTTP
dispatch into a [`@convex-dev/workpool`](https://www.npmjs.com/package/@convex-dev/workpool)
subcomponent mounted inside the auth component**. The workpool drives
retries with exponential backoff (5 attempts, 1s initial, 2× base). On
success the delivery row transitions `status: "delivered"`; after the
final failed attempt it stays at `"failed"` with `lastError` and
`lastResponseStatus` populated. Creating a delivery and starting or settling
an attempt each writes its matching audit event in the same transaction. An
audit failure aborts the state transition instead of silently leaving an
incomplete security record.

You don't poll, schedule, or wire anything yourself — emitting an event
is enough.

## Wire format

Outbound HTTP request:

| Header               | Value                                                                            |
| -------------------- | -------------------------------------------------------------------------------- |
| `Content-Type`       | `application/json`                                                               |
| `X-Auth-Event-Type`  | The auth event kind string (e.g. `connection.scim.set`)                          |
| `X-Auth-Delivery-Id` | The `GroupWebhookDelivery` document id (correlate with retries/logs)             |
| `X-Auth-Timestamp`   | Epoch milliseconds used in the signature pre-image                               |
| `X-Auth-Signature`   | `sha256=<hex>` — HMAC-SHA256 of `${timestamp}.${body}` using the endpoint secret |

Body:

```json
{
  "kind": "connection.scim.set",
  "payload": {
    /* event-specific */
  }
}
```

## Signature verification

Endpoints store the signing secret encrypted at rest
(`GroupWebhookEndpoint.secretCiphertext`, AES-GCM via
the secret-encryption key inside `AUTH_KEYS`). The lib decrypts it at emit time, computes
the HMAC, and persists `signature` + `signedAt` on the delivery row so
retries reuse the same signature.

The subscriber verifies by reconstructing the pre-image:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(headers: Headers, rawBody: string, sharedSecret: string) {
  const sig = headers.get("x-auth-signature") ?? "";
  const timestamp = headers.get("x-auth-timestamp") ?? "";
  if (!sig.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", sharedSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const got = Buffer.from(sig.slice("sha256=".length), "hex");
  const want = Buffer.from(expected, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
```
