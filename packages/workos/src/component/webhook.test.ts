import { createFunctionHandle, makeFunctionReference } from "convex/server";
import { actionGeneric } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.ts";
import schema from "./schema.ts";
import { json, list, modules, stubFetch } from "./workos.fixture.ts";

const WEBHOOK_SECRET = "webhook-secret";
const URL_OF_HOOK = "https://test.convex.site/workos/webhook";

const ring = makeFunctionReference<"action">("testApp:ring");
const rung = vi.fn();

function setup() {
  vi.stubEnv("CLIENT_ID", "client_1");
  vi.stubEnv("CLIENT_SECRET", "sk_test_1");
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site/workos");
  return convexTest(schema, {
    ...modules,
    "./testApp.ts": async () => ({
      ring: actionGeneric({ args: {}, handler: async () => rung() }),
    }),
  });
}

async function sign(body: string, timestamp: number, secret = WEBHOOK_SECRET) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `t=${timestamp}, v1=${hex}`;
}

async function register(t: ReturnType<typeof setup>) {
  stubFetch((url, init) => {
    if (url.pathname === "/webhook_endpoints" && init.method === "GET") {
      return json(list([]));
    }
    return json({
      object: "webhook_endpoint",
      id: "we_1",
      endpoint_url: URL_OF_HOOK,
      secret: WEBHOOK_SECRET,
      status: "enabled",
      events: [],
    });
  });
  const onRing = await t.run(async () => await createFunctionHandle(ring));
  return await t.action(api.webhook.register, { onRing });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rung.mockReset();
});

describe("the webhook", () => {
  const body = JSON.stringify({ id: "event_1", event: "dsync.user.updated" });

  test("registers one endpoint, subscribed to the events the copy applies", async () => {
    const t = setup();
    expect(await register(t)).toEqual({ endpointId: "we_1", created: true });
  });

  test("a verified delivery rings the app, and applies nothing", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      await register(t);
      const response = await t.fetch("/webhook", {
        method: "POST",
        headers: { "WorkOS-Signature": await sign(body, Date.now()) },
        body,
      });
      expect(response.status).toBe(200);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(rung).toHaveBeenCalledTimes(1);
      expect(
        await t.run(async (ctx) => await ctx.db.query("objects").collect()),
      ).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  test.each([
    ["no signature", async () => undefined],
    ["a wrong secret", async () => await sign(body, Date.now(), "other")],
    [
      "a stale timestamp",
      async () => await sign(body, Date.now() - 10 * 60 * 1000),
    ],
  ])("refuses a delivery with %s", async (_name, signature) => {
    const t = setup();
    await register(t);
    const header = await signature();
    const response = await t.fetch("/webhook", {
      method: "POST",
      headers: header === undefined ? {} : { "WorkOS-Signature": header },
      body,
    });
    expect(response.status).toBe(401);
  });

  test("refuses a signed delivery before the endpoint is registered", async () => {
    const t = setup();
    const response = await t.fetch("/webhook", {
      method: "POST",
      headers: { "WorkOS-Signature": await sign(body, Date.now()) },
      body,
    });
    expect(response.status).toBe(401);
  });
});
