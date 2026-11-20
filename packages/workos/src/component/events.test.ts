/**
 * Filling the copy and following WorkOS's events, through `pull` and `land`
 * as the app runs them, against a stub of WorkOS's API.
 *
 * @module
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.ts";
import type { Id } from "./_generated/dataModel.ts";
import type { WorkosEvent } from "./validators.ts";
import {
  CONNECTION,
  DIRECTORY,
  event,
  GROUP,
  json,
  list,
  ORGANIZATION,
  setup,
  stubFetch,
  USER,
} from "./workos.fixture.ts";

type T = ReturnType<typeof setup>;

const SECOND_ORGANIZATION = {
  ...ORGANIZATION,
  id: "org_2",
  name: "Globex",
  domains: [],
};

/**
 * WorkOS with one of each object, and `events` after the listing, one to a
 * page.
 */
function workos(events: object[] = []) {
  return stubFetch((url) => {
    const after = url.searchParams.get("after");
    switch (url.pathname) {
      case "/organizations":
        return json(
          after === null
            ? list([ORGANIZATION], "org_1")
            : list([SECOND_ORGANIZATION]),
        );
      case "/connections":
        return json(list([CONNECTION]));
      case "/directories":
        return json(list([DIRECTORY]));
      case "/directory_users":
        return json(list([USER]));
      case "/directory_groups":
        return json(list([GROUP]));
      case "/events": {
        const from = events.findIndex(
          (each) => "id" in each && each.id === after,
        );
        return json(list(events.slice(from + 1, from + 2)));
      }
      default:
        return json({ code: "not_found" }, 404);
    }
  });
}

/** Pull and land until WorkOS has nothing newer, and return every change. */
async function sync(t: T): Promise<WorkosEvent[]> {
  const changes: WorkosEvent[] = [];
  for (;;) {
    const pulled = await t.action(api.events.pull, {});
    if (pulled === null) return changes;
    changes.push(
      ...(await t.mutation(api.events.land, {
        until: pulled.until as Id<"pages">,
      })),
    );
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the copy", () => {
  test("fills by listing everything, then follows the events from when it started", async () => {
    const t = setup();
    const later = event("dsync.user.updated", { ...USER, state: "inactive" });
    const calls = workos([later]);

    const changes = await sync(t);

    expect(changes.map((change) => change.event)).toEqual([
      "organization.created",
      "organization.created",
      "connection.activated",
      "dsync.activated",
      "dsync.user.created",
      "dsync.group.created",
      "dsync.user.updated",
    ]);
    const paths = calls.map((call) => call.url.pathname);
    expect(paths.slice(0, 6)).toEqual([
      "/organizations",
      "/organizations",
      "/connections",
      "/directories",
      "/directory_users",
      "/directory_groups",
    ]);
    const [first, next] = calls
      .filter((call) => call.url.pathname === "/events")
      .map((call) => call.url.searchParams);
    expect(Date.parse(first?.get("range_start") ?? "")).not.toBeNaN();
    expect(first?.get("after")).toBeNull();
    expect(first?.getAll("events")).toContain("dsync.user.updated");
    expect(next?.get("after")).toBe(later.id);
    expect(next?.get("range_start")).toBeNull();
    expect(
      calls.every(
        (call) =>
          new Headers(call.init.headers).get("Authorization") ===
          "Bearer sk_test_1",
      ),
    ).toBe(true);

    expect(
      await t.query(api.organizationDomains.get, { domain: "ada@ACME.com" }),
    ).toMatchObject({
      organization: { id: "org_1", name: "Acme" },
      connection: { id: "conn_1", state: "active" },
    });
    const users = await t.query(api.directoryUsers.list, {
      filter: { email: "ADA@acme.com" },
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(users.page).toMatchObject([
      { id: "directory_user_1", email: "ada@acme.com", state: "inactive" },
    ]);
    expect(
      (
        await t.query(api.organizations.list, {
          paginationOpts: { numItems: 10, cursor: null },
        })
      ).page.map((organization) => organization.id),
    ).toEqual(["org_1", "org_2"]);
  });

  test("two pulls from one cursor stage one page, which lands once", async () => {
    const t = setup();
    workos();
    const first = await t.action(api.events.pull, {});
    const second = await t.action(api.events.pull, {});
    expect(second).toEqual(first);
    const until = first?.until as Id<"pages">;
    expect(await t.mutation(api.events.land, { until })).toHaveLength(1);
    expect(await t.mutation(api.events.land, { until })).toEqual([]);
  });

  test("a pull a landing overtook stages nothing", async () => {
    const t = setup();
    workos();
    const pulled = await t.action(api.events.pull, {});
    await t.mutation(api.events.land, { until: pulled?.until as Id<"pages"> });
    expect(
      await t.mutation(internal.events.stage, {
        after: null,
        position: { step: "connections", since: new Date().toISOString() },
        events: [],
      }),
    ).toBeNull();
  });

  test("a page that no longer follows the cursor is dropped", async () => {
    const t = setup();
    workos();
    const pulled = await t.action(api.events.pull, {});
    const until = pulled?.until as Id<"pages">;
    await t.mutation(api.events.reset, {});
    await t.run(async (ctx) => {
      await ctx.db.insert("pages", {
        state: "landed",
        after: null,
        position: { step: "since", at: new Date().toISOString() },
      });
    });
    const stale = await t.mutation(internal.events.stage, {
      after: null,
      position: { step: "connections", since: new Date().toISOString() },
      events: [],
    });
    expect(stale).toBeNull();
    await t.run(async (ctx) => {
      await ctx.db.insert("pages", {
        state: "staged",
        after: until,
        position: { step: "connections", since: new Date().toISOString() },
        events: [],
      });
    });
    const orphan = await t.run(
      async (ctx) =>
        await ctx.db
          .query("pages")
          .withIndex("state_after", (q) =>
            q.eq("state", "staged").eq("after", until),
          )
          .unique(),
    );
    const id = orphan?._id as Id<"pages">;
    expect(await t.mutation(api.events.land, { until: id })).toEqual([]);
    expect(await t.run(async (ctx) => await ctx.db.get("pages", id))).toBe(
      null,
    );
  });

  test("a deleted directory takes its users and groups, as deletions", async () => {
    const t = setup();
    workos([event("dsync.deleted", { ...DIRECTORY, state: "deleting" })]);
    const changes = await sync(t);
    expect(changes.slice(-3).map((change) => change.event)).toEqual([
      "dsync.deleted",
      "dsync.user.deleted",
      "dsync.group.deleted",
    ]);
    const rest = await t.run(
      async (ctx) => await ctx.db.query("objects").collect(),
    );
    expect(rest.map((row) => row.object).sort()).toEqual([
      "connection",
      "organization",
      "organization",
      "organization_domain",
    ]);
  });

  test("an organization's domains are the ones it lists", async () => {
    const t = setup();
    workos([
      event("organization.updated", {
        ...ORGANIZATION,
        domains: [
          {
            object: "organization_domain",
            id: "org_domain_1",
            domain: "acme.com",
          },
          {
            object: "organization_domain",
            id: "org_domain_2",
            domain: "acme.io",
          },
        ],
      }),
      event("organization.updated", { ...ORGANIZATION, domains: [] }),
    ]);
    const states: string[][] = [];
    for (;;) {
      const pulled = await t.action(api.events.pull, {});
      if (pulled === null) break;
      await t.mutation(api.events.land, { until: pulled.until as Id<"pages"> });
      const domains = await t.query(api.organizationDomains.list, {
        organizationId: "org_1",
      });
      states.push(domains.map((domain) => `${domain.domain}:${domain.state}`));
    }
    expect(states.slice(-2)).toEqual([
      ["acme.com:verified", "acme.io:pending"],
      [],
    ]);
  });

  test("an events window older than WorkOS answers at once is stepped through", async () => {
    const t = setup();
    const calls = workos();
    const at = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    await t.run(async (ctx) => {
      await ctx.db.insert("pages", {
        state: "landed",
        after: null,
        position: { step: "since", at },
      });
    });
    const pulled = await t.action(api.events.pull, {});
    expect(pulled).not.toBeNull();
    const query = calls[0]?.url.searchParams;
    expect(query?.get("range_start")).toBe(at);
    const end = Date.parse(query?.get("range_end") ?? "");
    expect(end - Date.parse(at)).toBe(30 * 24 * 60 * 60 * 1000);
    await t.mutation(api.events.land, { until: pulled?.until as Id<"pages"> });
    expect(await t.action(api.events.pull, {})).toBeNull();
  });

  test("a payload that does not decode stages nothing", async () => {
    const t = setup();
    workos([event("dsync.user.updated", { ...USER, state: "archived" })]);
    const pulled = await t.action(api.events.pull, {});
    await t.mutation(api.events.land, { until: pulled?.until as Id<"pages"> });
    stubFetch(() =>
      json(list([event("dsync.user.updated", { ...USER, state: "archived" })])),
    );
    await t.run(async (ctx) => {
      const landed = await ctx.db.query("pages").first();
      if (landed !== null) {
        await ctx.db.patch("pages", landed._id, {
          position: { step: "after", id: "event_0" },
        });
      }
    });
    await expect(t.action(api.events.pull, {})).rejects.toThrow(
      /\.data\.state/,
    );
    const staged = await t.run(
      async (ctx) =>
        await ctx.db
          .query("pages")
          .withIndex("state_after", (q) => q.eq("state", "staged"))
          .collect(),
    );
    expect(staged).toEqual([]);
  });

  test("reset empties the copy, and the next pull fills it again", async () => {
    const t = setup();
    workos();
    await sync(t);
    for (;;) {
      const { done } = await t.mutation(api.events.reset, {});
      if (done) break;
    }
    expect(
      await t.run(async (ctx) => await ctx.db.query("objects").collect()),
    ).toEqual([]);
    const pulled = await t.action(api.events.pull, {});
    expect(pulled?.after).toBeNull();
  });
});
