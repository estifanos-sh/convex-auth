---
title: Testing
description: Test authenticated Convex functions with real component identities.
---

# Testing

Authentication tests should exercise the same component records and identity
claims as production. A made-up string cast to a session ID can make the
application compile while skipping session expiry, revocation, membership, and
active-group behavior. The test entrypoint registers the component and creates
typed fixtures so application tests do not need to call component internals.

Create the application harness once. Pass its generated `components.auth`
reference to `createAuthTest`; that generated reference is what binds the
fixture helpers to the mounted component.

```ts
// convex/test.setup.ts
import { createAuthTest, register } from "@estifanos-sh/convex-auth/test";
import { convexTest } from "convex-test";
import { components } from "./_generated/api";
import schema from "./schema";

export function setupTest() {
  const t = convexTest(schema);
  register(t);
  return { t, auth: createAuthTest(t, components.auth) };
}
```

A protected-function test can now create a real user, group, membership, and
session without asserting any IDs. `session.create` returns the exact identity
shape expected by `t.withIdentity` and supplies a one-hour expiry unless the
test chooses another expiration time.

```ts
test("lists records for the active group", async () => {
  const { t, auth } = setupTest();
  const userId = await auth.user.create({
    data: { email: "alice@example.com", name: "Alice" },
  });
  const groupId = await auth.group.create({ name: "Acme" });
  await auth.member.create({ userId, groupId, roleIds: ["member"] });
  const { identity } = await auth.session.create({ userId });

  const result = await t.withIdentity(identity).query(api.records.list, {});
  expect(result).toEqual([]);
});
```

Use these fixtures for application behavior. White-box tests inside Convex Auth
itself may still invoke private component functions when the private protocol is
the subject of the test. Consumer applications should not learn those internal
function names merely to arrange an authenticated caller.
