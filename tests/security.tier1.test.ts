import { components } from "@convex/_generated/api";
import schema from "@convex/schema";
import { safeParseXml } from "@estifanos-sh/convex-auth/server/connection/saml";
import { decryptSecret } from "@estifanos-sh/convex-auth/server/secret";
import { setURLSearchParam } from "@estifanos-sh/convex-auth/server/redirects";
import { ConvexError } from "convex/values";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";

test("safeParseXml rejects DOCTYPE declarations", () => {
  const billionLaughs = `<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
]>
<lolz>&lol2;</lolz>`;
  expect(() => safeParseXml(billionLaughs)).toThrow(/DOCTYPE_OR_ENTITY_FORBIDDEN/);
});

test("safeParseXml rejects bare ENTITY declarations", () => {
  const xml = `<root><!ENTITY x SYSTEM "file:///etc/passwd"><a/></root>`;
  expect(() => safeParseXml(xml)).toThrow(/DOCTYPE_OR_ENTITY_FORBIDDEN/);
});

test("safeParseXml accepts ordinary XML", () => {
  const doc = safeParseXml(`<root><child/></root>`);
  expect(doc).toBeDefined();
});

test("decryptSecret rejects ciphertext with more than two parts", async () => {
  process.env.AUTH_SECRET_ENCRYPTION_KEY = "test-key-for-tier1-regression";
  await expect(decryptSecret("a.b.c")).rejects.toThrow(/malformed/i);
});

test("decryptSecret rejects ciphertext with empty payload after dot", async () => {
  process.env.AUTH_SECRET_ENCRYPTION_KEY = "test-key-for-tier1-regression";
  await expect(decryptSecret("a.")).rejects.toThrow(/malformed/i);
});

test("setURLSearchParam throws structured error when input has no scheme", () => {
  let caught: unknown;
  try {
    setURLSearchParam("no-scheme-just-text", "token", "abc");
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(ConvexError);
  const message = (caught as Error).message;
  const data = (caught as ConvexError<{ code: string }>).data;
  expect(message.includes("INVALID_REDIRECT") || data?.code === "INVALID_REDIRECT").toBe(true);
});

test("setURLSearchParam still works on a regular http URL", () => {
  const out = setURLSearchParam("https://example.com/cb", "code", "xyz");
  expect(out).toContain("code=xyz");
});

test("components.auth.user.create rejects unknown fields in data", async () => {
  const t = convexTest(schema);
  await expect(
    t.run((ctx) =>
      ctx.runMutation(components.auth.user.create, {
        data: { name: "ok", arbitraryAttackField: "leaked" } as any,
      }),
    ),
  ).rejects.toThrow();
});

test("components.auth.user.create accepts valid User fields", async () => {
  const t = convexTest(schema);
  const id = await t.run((ctx) =>
    ctx.runMutation(components.auth.user.create, {
      data: { email: "ok@example.com", name: "ok" },
    }),
  );
  expect(typeof id).toBe("string");
});

test("components.auth.user.upsert rejects unknown fields in data", async () => {
  const t = convexTest(schema);
  await expect(
    t.run((ctx) =>
      ctx.runMutation(components.auth.user.upsert, {
        data: { unknownGarbage: true } as any,
      }),
    ),
  ).rejects.toThrow();
});

test("components.auth.user.list pages through with opaque cursor", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    for (let i = 0; i < 5; i += 1) {
      await ctx.runMutation(components.auth.user.create, {
        data: { email: `paginate-${i}@example.com`, name: `u${i}` },
      });
    }
  });

  const collected: unknown[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i += 1) {
    const page = (await t.run((ctx) =>
      ctx.runQuery(components.auth.user.list, {
        paginationOpts: { numItems: 2, cursor },
      }),
    )) as { page: unknown[]; isDone: boolean; continueCursor: string };
    collected.push(...page.page);
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  expect(collected.length).toBeGreaterThanOrEqual(5);
});
