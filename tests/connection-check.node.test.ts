import { check } from "@estifanos-sh/convex-auth/server/connection/checks";
import { convexToJson } from "convex/values";
import { expect, test } from "vite-plus/test";

/**
 * `check()` writes `message: undefined` on a passing check rather than omitting
 * the key, and the connection `checks[]` array is nested inside the validate
 * result rather than sitting at the top level of a return value.
 *
 * These pin that neither fact reaches the client: `convexToJsonInternal` passes
 * `includeTopLevelUndefined` as a literal `false` at every recursive call, so an
 * `undefined` field is dropped at any depth. If a future `convex` release
 * changes that, these fail rather than the wire shape silently changing.
 */
test("an undefined check message encodes the same as an absent one", () => {
  const encoded = convexToJson({ name: "dns_record_present", ok: true, message: undefined });
  expect(encoded).toStrictEqual(convexToJson({ name: "dns_record_present", ok: true }));
  expect(Object.keys(encoded as object)).toStrictEqual(["name", "ok"]);
});

test("nesting a check does not reintroduce its undefined message", () => {
  expect(
    convexToJson({
      ok: true,
      checks: [{ name: "challenge_active", ok: true, message: undefined }],
    }),
  ).toStrictEqual({ ok: true, checks: [{ name: "challenge_active", ok: true }] });
});

test("check reports its message only on failure", () => {
  expect(convexToJson(check("token_hash_set", true, "boom"))).toStrictEqual({
    name: "token_hash_set",
    ok: true,
  });
  expect(convexToJson(check("token_hash_set", false, "boom"))).toStrictEqual({
    message: "boom",
    name: "token_hash_set",
    ok: false,
  });
});
