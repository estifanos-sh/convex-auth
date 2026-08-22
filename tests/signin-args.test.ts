import { api } from "@convex/_generated/api";
import { vSignInActionArgs } from "@estifanos-sh/convex-auth/server/runtime";
import schema from "@convex/schema";
import { v } from "convex/values";
import { validate } from "convex-helpers/validators";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";

test("signIn exports a provider-backed discriminated request validator", () => {
  const validator = vSignInActionArgs([
    {
      id: "access",
      type: "credentials",
      params: v.object({ email: v.string(), pin: v.string() }),
      authorize: async () => null,
    },
  ]);

  expect(validator.kind).toBe("object");
  expect(validator.fields.request.kind).toBe("union");
  expect(validator.fields.request.members).toHaveLength(3);
  expect(
    validate(validator, {
      request: { provider: "access", params: { email: "person@example.com", pin: "1234" } },
    }),
  ).toBe(true);
  expect(
    validate(validator, {
      request: { provider: "access", params: { email: "person@example.com", pin: 1234 } },
    }),
  ).toBe(false);
});

test("signIn rejects incomplete password parameters", async () => {
  const t = convexTest(schema);

  await expect(
    t.action(api.auth.signIn, {
      request: {
        provider: "password",
        params: { flow: "signIn", email: "missing-password@example.com" },
      },
    } as never),
  ).rejects.toThrow(/password/i);
});

test("signIn rejects provider ids absent from the materialized provider registry", async () => {
  const t = convexTest(schema);

  await expect(
    t.action(api.auth.signIn, {
      request: { provider: "not-configured", params: { anything: "value" } },
    } as never),
  ).rejects.toThrow(/literal|provider|argument/i);
});

test("signIn retains WebAuthn ceremony parameters", async () => {
  const t = convexTest(schema);

  const result = await t.action(api.auth.signIn, {
    request: { provider: "webauthn", params: { flow: "signIn" } },
  } as never);

  expect(result.kind).toBe("webauthnOptions");
});
