import { convexTest } from "convex-test";
import {
  createFunctionHandle,
  internalMutationGeneric,
  makeFunctionReference,
  mutationGeneric,
} from "convex/server";
import { v } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.ts";
import schema, { vWorkosDirectoryChange } from "./schema.ts";
import type { WorkosDirectoryChange } from "./schema.ts";

const modules = import.meta.glob("./**/*.ts");

type Json = Record<string, unknown>;

/**
 * A WorkOS environment, as much of its API as the copy reads: listings that
 * page through `after`, and reads by id. `failures` answers the next calls
 * with those statuses first.
 */
class FakeWorkos {
  organizations: Json[] = [];
  connections: Json[] = [];
  directories: Json[] = [];
  users: Json[] = [];
  groups: Json[] = [];
  memberships: Array<{ group: string; user: string }> = [];
  failures: number[] = [];
  calls: string[] = [];
  now = Date.parse("2026-01-01T00:00:00Z");

  private page(items: Json[], params: URLSearchParams) {
    const limit = Number(params.get("limit") ?? "10");
    const after = params.get("after");
    const start =
      after === null ? 0 : items.findIndex((item) => item.id === after) + 1;
    const data = items.slice(start, start + limit);
    const more = start + limit < items.length;
    return {
      object: "list",
      data,
      list_metadata: { after: more ? data[data.length - 1]?.id : null },
    };
  }

  private byId(collection: string, id: string): Json | undefined {
    const domains = this.organizations.flatMap((organization) =>
      Array.isArray(organization.domains)
        ? organization.domains.map((domain: Json) => ({
            ...domain,
            organization_id: organization.id,
          }))
        : [],
    );
    const held: Record<string, Json[]> = {
      organizations: this.organizations,
      organization_domains: domains,
      connections: this.connections,
      directories: this.directories,
      directory_users: this.users,
      directory_groups: this.groups,
    };
    return held[collection]?.find((item) => item.id === id);
  }

  respond(url: URL): Response {
    this.calls.push(url.pathname);
    const params = url.searchParams;
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { Date: new Date(this.now).toUTCString() },
      });
    const failure = this.failures.shift();
    if (failure !== undefined) return json({ code: "unavailable" }, failure);
    const [, collection, id] = url.pathname.split("/");
    if (collection !== undefined && id !== undefined) {
      const found = this.byId(collection, decodeURIComponent(id));
      return found === undefined
        ? json({ code: "entity_not_found" }, 404)
        : json(found);
    }
    switch (url.pathname) {
      case "/organizations":
        return json(this.page(this.organizations, params));
      case "/connections":
        return json(this.page(this.connections, params));
      case "/directories":
        return json(this.page(this.directories, params));
      case "/directory_users": {
        const group = params.get("group");
        if (group === null) {
          return json(
            this.page(
              this.users.filter(
                (user) => user.directory_id === params.get("directory"),
              ),
              params,
            ),
          );
        }
        const members = new Set(
          this.memberships
            .filter((membership) => membership.group === group)
            .map((membership) => membership.user),
        );
        return json(
          this.page(
            this.users.filter((user) => members.has(String(user.id))),
            params,
          ),
        );
      }
      case "/directory_groups":
        return json(
          this.page(
            this.groups.filter(
              (group) => group.directory_id === params.get("directory"),
            ),
            params,
          ),
        );
      default:
        return json({ code: "not_found" }, 404);
    }
  }
}

const at = (ms: number) => new Date(ms).toISOString();

function organization(id: string, domains: string[], updated = 0): Json {
  return {
    object: "organization",
    id,
    name: `Org ${id}`,
    domains: domains.map((domain, index) => ({
      id: `org_domain_${id}_${index}`,
      domain,
      state: "verified",
    })),
    updated_at: at(updated),
  };
}

function user(id: string, state = "active", updated = 0): Json {
  return {
    object: "directory_user",
    id,
    directory_id: "directory_1",
    organization_id: "org_1",
    idp_id: `idp_${id}`,
    email: `${id}@example.com`,
    first_name: "First",
    last_name: "Last",
    state,
    updated_at: at(updated),
  };
}

function group(id: string, updated = 0): Json {
  return {
    object: "directory_group",
    id,
    directory_id: "directory_1",
    organization_id: "org_1",
    name: `Group ${id}`,
    updated_at: at(updated),
  };
}

const DIRECTORY = {
  object: "directory",
  id: "directory_1",
  organization_id: "org_1",
  name: "Okta",
  type: "okta scim v2.0",
  state: "linked",
  updated_at: at(0),
};

const WEBHOOK_SECRET = "webhook-secret";

let changes: WorkosDirectoryChange[] = [];
let refuse: ((change: WorkosDirectoryChange) => boolean) | undefined;

const onChange = makeFunctionReference<
  "mutation",
  { change: WorkosDirectoryChange },
  null
>("testApp:onChange");

const register = makeFunctionReference<"mutation", Record<string, never>, null>(
  "testApp:register",
);

const testApp = {
  onChange: internalMutationGeneric({
    args: { change: vWorkosDirectoryChange },
    returns: v.null(),
    handler: async (_ctx, args) => {
      if (refuse?.(args.change) === true) {
        throw new Error("the app refused the change");
      }
      changes.push(args.change);
      return null;
    },
  }),
  register: mutationGeneric({
    args: {},
    returns: v.null(),
    handler: async (ctx) => {
      await ctx.db.insert("webhook", {
        endpointId: "we_1",
        url: "https://test.convex.site/workos/webhook",
        secret: WEBHOOK_SECRET,
        onChange: await createFunctionHandle(onChange),
      });
      return null;
    },
  }),
};

function setup(workos: FakeWorkos) {
  vi.stubEnv("CLIENT_ID", "client_1");
  vi.stubEnv("CLIENT_SECRET", "sk_test_1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) =>
      workos.respond(new URL(String(input))),
    ),
  );
  return convexTest(schema, {
    ...modules,
    "./testApp.ts": async () => testApp,
  });
}

async function reconcile(t: ReturnType<typeof setup>) {
  await t.mutation(api.reconcile.start, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function sign(body: string, timestamp: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
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

/** Deliver one event to the webhook, signed as WorkOS signs it. */
async function deliver(
  t: ReturnType<typeof setup>,
  event: string,
  data: Json,
): Promise<number> {
  vi.advanceTimersByTime(1000);
  const body = JSON.stringify({
    object: "event",
    id: `event_${event}`,
    event,
    data,
    created_at: new Date(Date.now()).toISOString(),
  });
  const response = await t.fetch("/webhook", {
    method: "POST",
    headers: { "WorkOS-Signature": await sign(body, Date.now()) },
    body,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers, 1000);
  return response.status;
}

function seeded(): FakeWorkos {
  const workos = new FakeWorkos();
  workos.organizations = [organization("org_1", ["example.com"])];
  workos.connections = [
    {
      object: "connection",
      id: "conn_1",
      organization_id: "org_1",
      connection_type: "OktaSAML",
      state: "active",
      updated_at: at(0),
    },
  ];
  workos.directories = [DIRECTORY];
  workos.users = [user("directory_user_1"), user("directory_user_2")];
  workos.groups = [group("directory_group_1")];
  workos.memberships = [
    { group: "directory_group_1", user: "directory_user_1" },
  ];
  return workos;
}

async function prepared(workos: FakeWorkos) {
  const t = setup(workos);
  await t.mutation(register, {});
  await reconcile(t);
  changes = [];
  return t;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-01-01T00:00:00Z"));
  changes = [];
  refuse = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reconcile", () => {
  test("refuses to start before the webhook is registered", async () => {
    const t = setup(seeded());
    await expect(t.mutation(api.reconcile.start, {})).rejects.toThrow(
      /Register the webhook/,
    );
  });

  test("the first run lists everything and tells the app", async () => {
    const t = setup(seeded());
    await t.mutation(register, {});
    await reconcile(t);

    expect(changes.map((change) => `${change.kind}:${change.action}`)).toEqual([
      "organization:upserted",
      "domain:upserted",
      "connection:upserted",
      "directory:upserted",
      "user:upserted",
      "user:upserted",
      "group:upserted",
      "member:added",
    ]);
    expect(
      await t.query(api.directory.route, { email: "Ada@EXAMPLE.com" }),
    ).toEqual({ organizationId: "org_1" });
    expect(
      await t.query(api.directory.route, { email: "ada@elsewhere.com" }),
    ).toBeNull();
    expect(
      await t.query(api.directory.findUsers, {
        organizationId: "org_1",
        idpId: "idp_directory_user_1",
      }),
    ).toMatchObject([{ id: "directory_user_1", state: "active" }]);
    expect(
      await t.query(api.directory.listUserGroups, {
        userId: "directory_user_1",
      }),
    ).toMatchObject([{ id: "directory_group_1" }]);
  });

  test("a second run with nothing new changes nothing", async () => {
    const t = await prepared(seeded());
    vi.advanceTimersByTime(1000);
    await reconcile(t);
    expect(changes).toEqual([]);
  });

  test("removes what the listings no longer show", async () => {
    const workos = seeded();
    const t = await prepared(workos);
    workos.users = [user("directory_user_1")];
    workos.memberships = [];
    workos.connections = [];
    vi.advanceTimersByTime(1000);
    await reconcile(t);

    expect(changes.map((change) => `${change.kind}:${change.action}`)).toEqual([
      "member:removed",
      "user:deleted",
      "connection:deleted",
    ]);
    expect(changes[1]).toMatchObject({
      user: { id: "directory_user_2" },
      deprovisioned: true,
    });
  });

  test("pages through a listing longer than a page", async () => {
    const workos = seeded();
    workos.users = Array.from({ length: 120 }, (_, index) =>
      user(`directory_user_${String(index).padStart(3, "0")}`),
    );
    workos.memberships = [];
    const t = setup(workos);
    await t.mutation(register, {});
    await reconcile(t);
    expect(changes.filter((change) => change.kind === "user")).toHaveLength(
      120,
    );
  });

  test("an overlapping older reconcile never makes a newer one remove a listed user", async () => {
    const workos = seeded();
    const t = await prepared(workos);
    const older = Date.now();
    vi.advanceTimersByTime(1000);
    const newer = Date.now();
    await t.action(internal.reconcile.run, {
      generation: newer,
      step: { stage: "organizations" },
    });
    await t.action(internal.reconcile.run, {
      generation: older,
      step: { stage: "organizations" },
    });
    await t.action(internal.reconcile.run, {
      generation: newer,
      step: { stage: "prune", kind: "user" },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(changes).toEqual([]);
    expect(
      await t.query(api.directory.getUser, { id: "directory_user_2" }),
    ).toMatchObject({ state: "active" });
  });

  test("waits and tries again when WorkOS answers 429 or 5xx", async () => {
    const workos = seeded();
    workos.failures = [503, 429];
    const t = setup(workos);
    await t.mutation(register, {});
    await reconcile(t);
    expect(changes.filter((change) => change.kind === "user")).toHaveLength(2);
    expect(workos.calls.slice(0, 3)).toEqual([
      "/organizations",
      "/organizations",
      "/organizations",
    ]);
  });
});

describe("webhook deliveries", () => {
  test("a delivery reads the object again, so order does not matter", async () => {
    const workos = seeded();
    const t = await prepared(workos);

    workos.users[0] = user("directory_user_1", "inactive", 3);
    for (const delivered of [
      user("directory_user_1", "inactive", 2),
      user("directory_user_1", "inactive", 3),
      user("directory_user_1", "active", 2.5),
    ]) {
      expect(await deliver(t, "dsync.user.updated", delivered)).toBe(200);
    }

    expect(changes).toEqual([
      {
        kind: "user",
        action: "upserted",
        user: expect.objectContaining({
          id: "directory_user_1",
          state: "inactive",
        }),
        deprovisioned: true,
      },
    ]);
    expect(
      await t.query(api.directory.getUser, { id: "directory_user_1" }),
    ).toMatchObject({ state: "inactive" });
  });

  test("a late membership add does not bring back a removed membership", async () => {
    const workos = seeded();
    const t = await prepared(workos);
    const membership = {
      directory_id: "directory_1",
      user: user("directory_user_1"),
      group: group("directory_group_1"),
    };

    workos.memberships = [];
    await deliver(t, "dsync.group.user_removed", membership);
    await deliver(t, "dsync.group.user_added", membership);

    expect(changes).toEqual([
      {
        kind: "member",
        action: "removed",
        member: {
          directoryId: "directory_1",
          groupId: "directory_group_1",
          userId: "directory_user_1",
        },
      },
    ]);
    expect(
      await t.query(api.directory.listUserGroups, {
        userId: "directory_user_1",
      }),
    ).toEqual([]);
  });

  test("a membership add the copy has not seen is listed in", async () => {
    const workos = seeded();
    const t = await prepared(workos);
    workos.memberships.push({
      group: "directory_group_1",
      user: "directory_user_2",
    });
    await deliver(t, "dsync.group.user_added", {
      directory_id: "directory_1",
      user: user("directory_user_2"),
      group: group("directory_group_1"),
    });
    expect(changes).toMatchObject([
      {
        kind: "member",
        action: "added",
        member: { userId: "directory_user_2" },
      },
    ]);
  });

  test("a deletion before the first write, and a late create after it, leave nothing", async () => {
    const workos = seeded();
    const t = await prepared(workos);
    const gone = user("directory_user_9");

    expect(await deliver(t, "dsync.user.deleted", gone)).toBe(200);
    expect(await deliver(t, "dsync.user.created", gone)).toBe(200);

    expect(changes).toEqual([]);
    expect(
      await t.query(api.directory.getUser, { id: "directory_user_9" }),
    ).toBeNull();
  });

  test("a deleted user goes with their memberships", async () => {
    const workos = seeded();
    const t = await prepared(workos);
    workos.users = [user("directory_user_2")];
    workos.memberships = [];

    await deliver(t, "dsync.user.deleted", user("directory_user_1"));

    expect(changes).toMatchObject([
      {
        kind: "user",
        action: "deleted",
        user: { id: "directory_user_1" },
        deprovisioned: true,
      },
    ]);
    expect(
      await t.query(api.directory.listUserGroups, {
        userId: "directory_user_1",
      }),
    ).toEqual([]);
  });

  test("a deleted directory takes its users with it", async () => {
    const workos = seeded();
    const t = await prepared(workos);
    workos.directories = [];

    await deliver(t, "dsync.deleted", { ...DIRECTORY, state: "deleting" });

    expect(changes.map((change) => `${change.kind}:${change.action}`)).toEqual([
      "member:removed",
      "user:deleted",
      "user:deleted",
      "group:deleted",
      "directory:deleted",
    ]);
    expect(
      await t.query(api.directory.getUser, { id: "directory_user_1" }),
    ).toBeNull();
  });

  test("a group of 16,001 members is listed and removed in batches", async () => {
    const workos = seeded();
    const t = await prepared(workos);
    const ids = Array.from(
      { length: 16_001 },
      (_, index) => `directory_user_${String(index).padStart(5, "0")}`,
    );
    workos.users = ids.map((id) => user(id));
    workos.memberships = ids.map((id) => ({
      group: "directory_group_1",
      user: id,
    }));

    await deliver(t, "dsync.group.user_added", {
      directory_id: "directory_1",
      user: user(ids[0] ?? ""),
      group: group("directory_group_1"),
    });
    const members = async () =>
      await t.run(
        async (ctx) =>
          (
            await ctx.db
              .query("directoryMembers")
              .withIndex("groupId_userId", (q) =>
                q.eq("groupId", "directory_group_1"),
              )
              .collect()
          ).length,
      );
    expect(await members()).toBe(16_001);

    changes = [];
    workos.groups = [];
    await deliver(t, "dsync.group.deleted", group("directory_group_1"));
    expect(await members()).toBe(0);
    expect(changes).toMatchObject([{ kind: "group", action: "deleted" }]);
  }, 120_000);

  test("a refused change fails the delivery, and its retry applies it", async () => {
    const workos = seeded();
    const t = await prepared(workos);
    vi.spyOn(console, "error").mockImplementation(() => {});
    refuse = (change) =>
      change.kind === "user" && change.user.id === "directory_user_1";

    workos.users[0] = user("directory_user_1", "inactive", 5);
    const data = user("directory_user_1", "inactive", 5);
    expect(await deliver(t, "dsync.user.updated", data).catch(() => 500)).toBe(
      500,
    );
    expect(changes).toEqual([]);
    expect(
      await t.query(api.directory.getUser, { id: "directory_user_1" }),
    ).toMatchObject({ state: "active" });

    refuse = undefined;
    expect(await deliver(t, "dsync.user.updated", data)).toBe(200);
    expect(changes).toMatchObject([
      { kind: "user", user: { id: "directory_user_1", state: "inactive" } },
    ]);
  });
});
