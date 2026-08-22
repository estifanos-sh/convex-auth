/**
 * Regression tests for atomic verifier acceptance (`component.token.pkce.accept`).
 *
 * Passkey and TOTP ceremonies run in actions. Reading and deleting the verifier
 * in separate transactions allowed concurrent requests to reuse one verifier.
 * `accept` folds read, validation, and removal into one mutation so exactly
 * one caller can win.
 */

import { components } from "@convex/_generated/api";
import schema from "@convex/schema";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";

test("pkce.accept is single-use", async () => {
  const t = convexTest(schema);
  const id = (await t.run((ctx) =>
    ctx.runMutation(components.auth.token.pkce.create, { signature: "sig-abc" }),
  )) as string;

  const first = (await t.run((ctx) =>
    ctx.runMutation(components.auth.token.pkce.accept, {
      selector: { id },
      expectedSignature: "sig-abc",
    }),
  )) as { _id: string } | null;
  expect(first?._id).toBe(id);

  const second = await t.run((ctx) =>
    ctx.runMutation(components.auth.token.pkce.accept, {
      selector: { id },
      expectedSignature: "sig-abc",
    }),
  );
  expect(second).toBeNull();
});

test("pkce.accept rejects a signature mismatch without removing the verifier", async () => {
  const t = convexTest(schema);
  const id = (await t.run((ctx) =>
    ctx.runMutation(components.auth.token.pkce.create, { signature: "real-sig" }),
  )) as string;

  const mismatch = await t.run((ctx) =>
    ctx.runMutation(components.auth.token.pkce.accept, {
      selector: { id },
      expectedSignature: "wrong-sig",
    }),
  );
  expect(mismatch).toBeNull();

  const accepted = (await t.run((ctx) =>
    ctx.runMutation(components.auth.token.pkce.accept, {
      selector: { id },
      expectedSignature: "real-sig",
    }),
  )) as { _id: string } | null;
  expect(accepted?._id).toBe(id);
});

test("pkce.accept removes an expired verifier without accepting it", async () => {
  const t = convexTest(schema);
  const id = (await t.run((ctx) =>
    ctx.runMutation(components.auth.token.pkce.create, {
      signature: "exp-sig",
      expirationTime: Date.now() - 1_000,
    }),
  )) as string;

  const expired = await t.run((ctx) =>
    ctx.runMutation(components.auth.token.pkce.accept, { selector: { id } }),
  );
  expect(expired).toBeNull();

  const gone = await t.run((ctx) =>
    ctx.runQuery(components.auth.token.pkce.get, { selector: { id }, now: Date.now() }),
  );
  expect(gone).toBeNull();
});
