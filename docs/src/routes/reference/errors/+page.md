---
title: Error Codes
description: Structured error codes returned by convex-auth.
---

<svelte:head>

  <title>Error Codes - convex-auth</title>
</svelte:head>

# Error Codes

All auth errors are plain `ConvexError` instances with a `{ code, message }`
payload. There are no special helpers needed - catch them directly with
`ConvexError` from the `convex/values` package.

```ts
// Unauthenticated callers never reach the handler.
export const authQuery = customQuery(query, auth.ctx());
```

`auth.ctx()` throws `NOT_SIGNED_IN` before your handler runs. In middleware or
custom integrations, `auth.context(ctx)` throws the same structured error.

For authorization checks, `auth.member.assert(...)` also throws a `ConvexError`
on failure:

```ts
import { ConvexError } from "convex/values";

try {
  await auth.member.assert(ctx, {
    userId,
    groupId,
    grants: ["some.grant"],
  });
} catch (e) {
  if (e instanceof ConvexError) {
    console.log(e.data.code); // e.g. "NOT_A_MEMBER" or "MISSING_GRANTS"
  }
}
```

## Auth errors

| Code                      | Description                                                        |
| ------------------------- | ------------------------------------------------------------------ |
| `NOT_SIGNED_IN`           | No valid session                                                   |
| `NOT_A_MEMBER`            | User is not a member of the group                                  |
| `MISSING_GRANTS`          | User is missing required grants                                    |
| `ACCOUNT_NOT_FOUND`       | Account does not exist                                             |
| `ACCOUNT_ALREADY_LINKED`  | A verified provider identity is already linked to a different user |
| `USER_NOT_FOUND`          | User does not exist                                                |
| `INVALID_PARAMETERS`      | Bad input arguments                                                |
| `INTERNAL_ERROR`          | Unexpected server error                                            |
| `PROVIDER_NOT_CONFIGURED` | Provider not in config                                             |

Mounted group SSO admin APIs may also throw `FORBIDDEN` when the app-level
authorization callback rejects the caller.

## API key errors

| Code                   | Description                       |
| ---------------------- | --------------------------------- |
| `MISSING_BEARER_TOKEN` | No/malformed Authorization header |
| `INVALID_API_KEY`      | Key not found                     |
| `API_KEY_REVOKED`      | Key has been revoked              |
| `API_KEY_EXPIRED`      | Key past expiration               |
| `API_KEY_RATE_LIMITED` | Per-key rate limit exceeded       |
| `SCOPE_CHECK_FAILED`   | Key lacks required scope          |

## Invite errors

| Code                   | Description                     |
| ---------------------- | ------------------------------- |
| `DUPLICATE_MEMBERSHIP` | User is already a member        |
| `DUPLICATE_INVITE`     | Invite already exists           |
| `INVITE_NOT_FOUND`     | Invite does not exist           |
| `INVITE_NOT_PENDING`   | Invite is not in pending status |
| `NO_ACTIVE_GROUP`      | No active group set             |

## Device flow errors

| Code                             | Description                      |
| -------------------------------- | -------------------------------- |
| `DEVICE_AUTHORIZATION_PENDING`   | User hasn't entered the code yet |
| `DEVICE_SLOW_DOWN`               | Polling too fast                 |
| `DEVICE_CODE_EXPIRED`            | Code expired                     |
| `DEVICE_CODE_INVALID`            | Code not found or already used   |
| `DEVICE_CODE_DENIED`             | Authorization explicitly denied  |
| `DEVICE_CODE_ALREADY_AUTHORIZED` | Code already authorized          |
