import { convexTest } from "convex-test";
import {
  createFunctionHandle,
  internalMutationGeneric,
  makeFunctionReference,
  mutationGeneric,
} from "convex/server";
import { v } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.ts";
import schema, { vWorkosDirectoryChange } from "./schema.ts";
import type { WorkosDirectoryChange } from "./schema.ts";

const modules = import.meta.glob("./**/*.ts");

type Json = Record<string, unknown>;

/**
 * A WorkOS environment, as much of its API as the sync calls. Its listings
 * page through `after`, and its events are the ones a test appends.
 */
class FakeWorkos {
  organizations: Json[] = [];
  connections: Json[] = [];
  directories: Json[] = [];
  users: Json[] = [];
  groups: Json[] = [];
  memberships: Array<{ group: string; user: string }> = [];
  events: Json[] = [];
  /** Answer a cursor read with this status, as for a cursor past retention. */
  refuseCursor: number | undefined;
  now = Date.parse("2026-01-01T00:00:00Z");

  event(event: string, data: Json) {
    this.now += 1000;
    this.events.push({
      object: "event",
      id: `event_${String(this.events.length + 1).padStart(4, "0")}`,
      event,
      data,
      created_at: new Date(this.now).toISOString(),
    });
  }

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

  respond(url: URL): Response {
    const params = url.searchParams;
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { Date: new Date(this.now).toUTCString() },
      });
    switch (url.pathname) {
      case "/events": {
        const after = params.get("after");
        if (after !== null && this.refuseCursor !== undefined) {
          return json({ code: "invalid_cursor" }, this.refuseCursor);
        }
        const since = params.get("range_start");
        const events =
          since === null
            ? this.events
            : this.events.filter(
                (event) =>
                  Date.parse(String(event.created_at)) >= Date.parse(since),
              );
        return json(this.page(events, params));
      }
      case "/organizations":
        return json(this.page(this.organizations, params));
      case "/connections":
        return json(this.page(this.connections, params));
      case "/directories":
        return json(this.page(this.directories, params));
      case "/directory_users": {
        const group = params.get("group");
        const users =
          group === null
            ? this.users.filter(
                (user) => user.directory_id === params.get("directory"),
              )
            : this.users.filter((user) =>
                this.memberships.some(
                  (membership) =>
                    membership.group === group && membership.user === user.id,
                ),
              );
        return json(this.page(users, params));
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

let changes: WorkosDirectoryChange[] = [];
let refuse: ((change: WorkosDirectoryChange) => boolean) | undefined;

const onChange = makeFunctionReference<
  "mutation",
  { change: WorkosDirectoryChange },
  null
>("testApp:onChange");

const sync = makeFunctionReference<"mutation", Record<string, never>, null>(
  "testApp:sync",
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
  sync: mutationGeneric({
    args: {},
    returns: v.null(),
    handler: async (ctx) => {
      await ctx.runMutation(api.sync.start, {
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

async function runSync(t: ReturnType<typeof setup>) {
  await t.mutation(sync, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
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

beforeEach(() => {
  vi.useFakeTimers();
  changes = [];
  refuse = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("directory sync", () => {
  test("the first run lists everything and tells the app", async () => {
    const t = setup(seeded());
    await runSync(t);

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
    expect(await t.query(api.sync.status, {})).toEqual({
      phase: "events",
      running: false,
    });
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
    const t = setup(seeded());
    await runSync(t);
    changes = [];
    await runSync(t);
    expect(changes).toEqual([]);
  });

  test("events deprovision, regroup and delete users in order", async () => {
    const workos = seeded();
    const t = setup(workos);
    await runSync(t);
    changes = [];

    workos.event("dsync.user.updated", user("directory_user_1", "inactive", 5));
    workos.event("dsync.group.user_removed", {
      directory_id: "directory_1",
      user: user("directory_user_1"),
      group: group("directory_group_1"),
    });
    workos.event("dsync.group.user_added", {
      directory_id: "directory_1",
      user: user("directory_user_2"),
      group: group("directory_group_1"),
    });
    workos.event("dsync.user.deleted", user("directory_user_2", "active", 6));
    await runSync(t);

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
      {
        kind: "member",
        action: "removed",
        member: {
          directoryId: "directory_1",
          groupId: "directory_group_1",
          userId: "directory_user_1",
        },
      },
      {
        kind: "member",
        action: "added",
        member: {
          directoryId: "directory_1",
          groupId: "directory_group_1",
          userId: "directory_user_2",
        },
      },
      {
        kind: "user",
        action: "deleted",
        user: expect.objectContaining({ id: "directory_user_2" }),
        deprovisioned: true,
      },
    ]);
    expect(
      await t.query(api.directory.listUserGroups, {
        userId: "directory_user_2",
      }),
    ).toEqual([]);
  });

  test("an older event never overwrites a newer row", async () => {
    const workos = seeded();
    workos.users = [user("directory_user_1", "active", 10)];
    const t = setup(workos);
    await runSync(t);
    changes = [];

    workos.event("dsync.user.updated", user("directory_user_1", "inactive", 5));
    await runSync(t);

    expect(changes).toEqual([]);
    expect(
      await t.query(api.directory.getUser, { id: "directory_user_1" }),
    ).toMatchObject({ state: "active" });
  });

  test("a deleted directory takes its users with it", async () => {
    const workos = seeded();
    const t = setup(workos);
    await runSync(t);
    changes = [];

    workos.event("dsync.deleted", { ...DIRECTORY, state: "deleting" });
    await runSync(t);

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

  test("a refused cursor starts over and drops what WorkOS no longer has", async () => {
    const workos = seeded();
    const t = setup(workos);
    await runSync(t);
    workos.event("dsync.user.updated", user("directory_user_1", "active", 5));
    await runSync(t);
    changes = [];

    // The user went while the sync could not read the stream.
    workos.users = [user("directory_user_1", "active", 5)];
    workos.memberships = [];
    workos.refuseCursor = 400;
    workos.event("dsync.group.updated", {
      ...group("directory_group_1", 7),
      name: "Renamed",
    });
    await runSync(t);
    workos.refuseCursor = undefined;

    // The listing finds nothing new, the prune removes what is gone, and the
    // stream, read again from the new boundary, applies the rename.
    expect(changes.map((change) => `${change.kind}:${change.action}`)).toEqual([
      "member:removed",
      "user:deleted",
      "group:upserted",
    ]);
    expect(changes[1]).toMatchObject({
      user: { id: "directory_user_2" },
      deprovisioned: true,
    });
  });

  test("a refused change stops the sync there until the next run", async () => {
    const workos = seeded();
    const t = setup(workos);
    await runSync(t);
    changes = [];
    vi.spyOn(console, "error").mockImplementation(() => {});

    workos.event("dsync.user.updated", user("directory_user_1", "inactive", 5));
    workos.event("dsync.user.updated", user("directory_user_2", "inactive", 6));
    refuse = (change) =>
      change.kind === "user" && change.user.id === "directory_user_1";
    await runSync(t);
    expect(changes).toEqual([]);
    expect((await t.query(api.sync.status, {})).error).toMatch(/refused/);

    refuse = undefined;
    await runSync(t);
    expect(
      changes.map((change) => (change.kind === "user" ? change.user.id : "")),
    ).toEqual(["directory_user_1", "directory_user_2"]);
    expect((await t.query(api.sync.status, {})).error).toBeUndefined();
  });
});
