import { api } from "@convex/_generated/api";
import schema from "@convex/schema";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";

test("signIn rejects incomplete password parameters", async () => {
  const t = convexTest(schema);

  await expect(
    t.action(api.auth.signIn, {
      provider: "password",
      params: { flow: "signIn", email: "missing-password@example.com" },
    } as never),
  ).rejects.toThrow(/password/i);
});

test("signIn rejects provider ids absent from the materialized provider registry", async () => {
  const t = convexTest(schema);

  await expect(
    t.action(api.auth.signIn, {
      provider: "not-configured",
      params: { anything: "value" },
    } as never),
  ).rejects.toThrow(/provider|argument/i);
});

test("signIn retains WebAuthn ceremony parameters", async () => {
  const t = convexTest(schema);

  const result = await t.action(api.auth.signIn, {
    provider: "webauthn",
    params: { flow: "signIn" },
  } as never);

  expect(result.kind).toBe("webauthnOptions");
});
