import { components } from "@convex/_generated/api";
import schema from "@convex/schema";
import { createAuthTest } from "@estifanos-sh/convex-auth/test";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";

test("typed auth fixtures create a real session identity", async () => {
  const t = convexTest(schema);
  const auth = createAuthTest(t, components.auth);
  const userId = await auth.user.create({
    data: { email: "fixture@example.com", name: "Fixture User" },
  });
  const { sessionId, identity } = await auth.session.create({ userId });

  expect(identity).toEqual({ subject: userId, sid: sessionId, session_epoch: 0 });

  const session = await t.run((ctx) =>
    ctx.runQuery(components.auth.session.get, { id: sessionId }),
  );
  expect(session?.userId).toBe(userId);
});
