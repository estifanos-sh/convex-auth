import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.ts";
import { EVENTS } from "./constants.ts";
import schema from "./schema.ts";

const modules = import.meta.glob("./**/*.ts");

const WEBHOOK_URL = "https://test.convex.site/workos/webhook";

type Endpoint = {
  object: "webhook_endpoint";
  id: string;
  endpoint_url: string;
  secret: string;
  status: "enabled" | "disabled";
  events: string[];
};

/** WorkOS's `/webhook_endpoints` API, paging through `after` like WorkOS. */
class FakeEndpoints {
  endpoints: Endpoint[] = [];
  calls: string[] = [];

  add(url: string, fields: Partial<Endpoint> = {}): Endpoint {
    const endpoint: Endpoint = {
      object: "webhook_endpoint",
      id: `we_${this.endpoints.length + 1}`,
      endpoint_url: url,
      secret: `secret_${this.endpoints.length + 1}`,
      status: "enabled",
      events: [...EVENTS],
      ...fields,
    };
    this.endpoints.push(endpoint);
    return endpoint;
  }

  async respond(url: URL, init: RequestInit): Promise<Response> {
    const method = init.method ?? "GET";
    this.calls.push(`${method} ${url.pathname}`);
    const body: unknown =
      typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const json = (value: unknown) => new Response(JSON.stringify(value));
    if (url.pathname === "/webhook_endpoints" && method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? "10");
      const after = url.searchParams.get("after");
      const start =
        after === null
          ? 0
          : this.endpoints.findIndex((item) => item.id === after) + 1;
      const data = this.endpoints.slice(start, start + limit);
      const more = start + limit < this.endpoints.length;
      return json({
        object: "list",
        data,
        list_metadata: { after: more ? data[data.length - 1]?.id : null },
      });
    }
    if (url.pathname === "/webhook_endpoints" && method === "POST") {
      const { endpoint_url, events } = body as {
        endpoint_url: string;
        events: string[];
      };
      return json(this.add(endpoint_url, { events }));
    }
    const id = url.pathname.split("/").pop();
    const endpoint = this.endpoints.find((item) => item.id === id);
    if (endpoint !== undefined && method === "PATCH") {
      Object.assign(endpoint, body);
      return json(endpoint);
    }
    if (endpoint !== undefined && method === "DELETE") {
      this.endpoints = this.endpoints.filter((item) => item !== endpoint);
      return new Response(null, { status: 202 });
    }
    return new Response(JSON.stringify({ code: "not_found" }), {
      status: 404,
    });
  }

  install() {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (input: string | URL | Request, init?: RequestInit) =>
          await this.respond(new URL(String(input)), init ?? {}),
      ),
    );
  }
}

function setup() {
  vi.stubEnv("CLIENT_ID", "client_1");
  vi.stubEnv("CLIENT_SECRET", "sk_test_1");
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site/workos");
  const workos = new FakeEndpoints();
  workos.install();
  return { t: convexTest(schema, modules), workos };
}

async function kept(t: ReturnType<typeof setup>["t"]) {
  return await t.run(async (ctx) => await ctx.db.query("webhook").collect());
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("webhook.register", () => {
  test("creates the endpoint once, subscribed to the sync's events", async () => {
    const { t, workos } = setup();
    expect(await t.action(api.webhook.register, {})).toEqual({
      endpointId: "we_1",
      created: true,
    });
    expect(await t.action(api.webhook.register, {})).toEqual({
      endpointId: "we_1",
      created: false,
    });
    expect(workos.endpoints).toHaveLength(1);
    expect(workos.endpoints[0]?.endpoint_url).toBe(WEBHOOK_URL);
    expect(workos.endpoints[0]?.events).toEqual([...EVENTS]);
    expect(
      (await kept(t)).map(({ endpointId, url, secret }) => ({
        endpointId,
        url,
        secret,
      })),
    ).toEqual([{ endpointId: "we_1", url: WEBHOOK_URL, secret: "secret_1" }]);
  });

  test("finds its endpoint past the first page of other deployments' endpoints", async () => {
    const { t, workos } = setup();
    for (let i = 0; i < 150; i += 1) {
      workos.add(`https://other-${i}.convex.site/workos/webhook`);
    }
    const mine = workos.add(WEBHOOK_URL);
    expect(await t.action(api.webhook.register, {})).toEqual({
      endpointId: mine.id,
      created: false,
    });
    expect(workos.endpoints).toHaveLength(151);
    expect(workos.calls).toEqual([
      "GET /webhook_endpoints",
      "GET /webhook_endpoints",
    ]);
    expect((await kept(t)).map((row) => row.secret)).toEqual([mine.secret]);
  });

  test("enables a disabled endpoint and subscribes it to missing events", async () => {
    const { t, workos } = setup();
    const endpoint = workos.add(WEBHOOK_URL, {
      status: "disabled",
      events: ["user.created", "dsync.user.created"],
    });
    await t.action(api.webhook.register, {});
    expect(endpoint.status).toBe("enabled");
    expect(new Set(endpoint.events)).toEqual(
      new Set(["user.created", ...EVENTS]),
    );
    expect(workos.calls).toContain(`PATCH /webhook_endpoints/${endpoint.id}`);
  });

  test("keeps no secret when WorkOS refuses", async () => {
    const { t } = setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    await expect(t.action(api.webhook.register, {})).rejects.toThrow(/401/);
    expect(await kept(t)).toEqual([]);
  });
});

describe("webhook.prune", () => {
  const PATTERN = { host: ".convex.site", path: "/workos/webhook" };
  const preview = (name: string) =>
    `https://${name}.convex.site/workos/webhook`;

  test("deletes the pattern's endpoints that are not kept, and nothing else", async () => {
    const { t, workos } = setup();
    const own = workos.add(WEBHOOK_URL);
    const live = workos.add(preview("live-otter-1"));
    const gone = workos.add(preview("gone-otter-2"));
    const goneToo = workos.add(preview("gone-otter-3"));
    const others = [
      workos.add("https://hooks.example.com/workos/webhook"),
      workos.add("https://evilconvex.site/workos/webhook"),
      workos.add("http://plain-otter-4.convex.site/workos/webhook"),
      workos.add("https://other-otter-5.convex.site/other/webhook"),
      workos.add("https://query-otter-6.convex.site/workos/webhook?x=1"),
    ];
    const result = await t.action(api.webhook.prune, {
      ...PATTERN,
      keep: [live.endpoint_url],
    });
    expect(result).toEqual({ deleted: [gone.id, goneToo.id] });
    expect(workos.endpoints.map((endpoint) => endpoint.id)).toEqual([
      own.id,
      live.id,
      ...others.map((endpoint) => endpoint.id),
    ]);
  });

  test("never deletes the calling deployment's own endpoint", async () => {
    const { t, workos } = setup();
    vi.stubEnv("CONVEX_SITE_URL", "https://self-otter-7.convex.site/workos");
    const own = workos.add(preview("self-otter-7"));
    expect(await t.action(api.webhook.prune, { ...PATTERN, keep: [] })).toEqual(
      { deleted: [] },
    );
    expect(workos.endpoints).toEqual([own]);
  });

  test("lists every page before it deletes", async () => {
    const { t, workos } = setup();
    for (let i = 0; i < 120; i += 1) workos.add(preview(`gone-${i}`));
    const { deleted } = await t.action(api.webhook.prune, {
      ...PATTERN,
      keep: [],
    });
    expect(deleted).toHaveLength(120);
    expect(workos.endpoints).toEqual([]);
    expect(workos.calls.slice(0, 2)).toEqual([
      "GET /webhook_endpoints",
      "GET /webhook_endpoints",
    ]);
  });

  test("counts an endpoint another prune deleted first as gone", async () => {
    const { t, workos } = setup();
    const raced = workos.add(preview("raced-otter-8"));
    const gone = workos.add(preview("gone-otter-9"));
    const respond = workos.respond.bind(workos);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (init?.method === "DELETE" && url.pathname.endsWith(raced.id)) {
          return new Response(JSON.stringify({ code: "not_found" }), {
            status: 404,
          });
        }
        return await respond(url, init ?? {});
      }),
    );
    expect(await t.action(api.webhook.prune, { ...PATTERN, keep: [] })).toEqual(
      { deleted: [gone.id] },
    );
  });

  test.each([
    ["an empty host", { host: "", path: "/workos/webhook" }],
    ["a bare top-level host", { host: ".site", path: "/workos/webhook" }],
    [
      "a host without a leading dot",
      { host: "convex.site", path: "/workos/webhook" },
    ],
    ["the root path", { host: ".convex.site", path: "/" }],
  ])("refuses %s, deleting nothing", async (_name, pattern) => {
    const { t, workos } = setup();
    workos.add(preview("gone-otter-10"));
    await expect(
      t.action(api.webhook.prune, { ...pattern, keep: [] }),
    ).rejects.toThrow(/prune's/);
    expect(workos.endpoints).toHaveLength(1);
  });
});
