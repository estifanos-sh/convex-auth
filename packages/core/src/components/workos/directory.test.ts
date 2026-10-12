/**
 * The directory sync against an in-memory WorkOS: first install, the event
 * stream, failures and their recovery, and the reads of the copy.
 */
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api.ts";
import {
  type Backend,
  copy,
  expected,
  type FakeWorkOS,
  quiesce,
  replica,
  settle,
  setup,
  status,
  testAppRef,
} from "../workosTestSetup.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Listed = { data: Record<string, unknown>[] } & Record<string, unknown>;

// Rewrites WorkOS's answers on one path, as a stand-in for what the fake never sends itself.
function intercept(
  fake: FakeWorkOS,
  path: string,
  rewrite: (body: Listed) => Listed,
) {
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fake.fetch(input, init);
      if (
        new URL(new Request(input, init).url).pathname !== path ||
        !response.ok
      )
        return response;
      const body: Listed = await response.json();
      return new Response(JSON.stringify(rewrite(body)), {
        status: response.status,
        headers: response.headers,
      });
    },
  );
}

function seed(fake: FakeWorkOS) {
  const acme = fake.organization("Acme", [{ domain: "acme.test" }]);
  const globex = fake.organization("Globex", [
    { domain: "globex.test", state: "pending" },
  ]);
  const ada = fake.user("ada@acme.test");
  const bob = fake.user("bob@globex.test");
  fake.membership(ada, acme, "admin");
  fake.membership(bob, globex, "member", "pending");
  fake.connection(acme);
  const directory = fake.directory(acme);
  const carol = fake.directoryUser(directory, "carol@acme.test");
  const dan = fake.directoryUser(directory, "dan@acme.test");
  const staff = fake.group(directory, "Staff");
  fake.addToGroup(staff, carol);
  fake.addToGroup(staff, dan);
  return { acme, globex, ada, bob, directory, carol, dan, staff };
}

describe("the sync engine", () => {
  it("backfills a first install from the list endpoints and lands on the fake state", async () => {
    const { t, fake } = setup();
    seed(fake);
    await quiesce(t);
    expect(await copy(t)).toEqual(fake.snapshot());
    expect(await replica(t)).toEqual(expected(fake));
    const now = await status(t);
    expect(now).toMatchObject({ bounded: true, pending: false, open: 0 });
    expect(now.error).toBeUndefined();
  });

  it("follows the event stream after the boundary, applying edits, deletes and edges", async () => {
    const { t, fake } = setup();
    const { acme, ada, directory, carol, dan, staff } = seed(fake);
    await quiesce(t);

    fake.renameOrganization(acme, "Acme Corp");
    fake.setDomains(acme, [
      { domain: "acme.test" },
      { domain: "acme.example" },
    ]);
    const eve = fake.user("eve@acme.test");
    fake.membership(eve, acme);
    fake.removeFromGroup(staff, carol);
    const ops = fake.group(directory, "Ops");
    fake.addToGroup(ops, dan);
    fake.suspendDirectoryUser(dan);
    fake.deleteUser(ada);
    await quiesce(t);

    expect(await copy(t)).toEqual(fake.snapshot());
    expect(await replica(t)).toEqual(expected(fake));
    const name = await t.query(api.directory.organization, { workosId: acme });
    expect(name?.name).toBe("Acme Corp");
  });

  it("tombstones every descendant of a deleted organization or directory", async () => {
    const { t, fake } = setup();
    const { acme, globex } = seed(fake);
    const second = fake.directory(globex, "Azure");
    const frank = fake.directoryUser(second, "frank@globex.test");
    const team = fake.group(second, "Team");
    fake.addToGroup(team, frank);
    await quiesce(t);

    fake.deleteOrganization(acme);
    fake.deleteDirectory(second);
    await quiesce(t);

    expect(await copy(t)).toEqual(fake.snapshot());
    expect(await replica(t)).toEqual(expected(fake));
    expect(
      await t.query(api.directory.organization, { workosId: acme }),
    ).toBeNull();
  });

  it("sends each mirrored change to the app inside the transaction that applies it", async () => {
    const { t, fake } = setup();
    const { acme } = seed(fake);
    await quiesce(t);
    const replicas = await t.run(
      async (ctx) => await ctx.db.query("replica").collect(),
    );
    expect(replicas.find((row) => row.key === acme)).toMatchObject({
      kind: "organization",
      deleted: false,
    });
  });

  it("stops the stream on a 401, keeps the cursor and sweeps nothing until a new key is bound", async () => {
    const { t, fake } = setup();
    seed(fake);
    await quiesce(t);
    const before = await status(t);

    fake.organization("Initech");
    vi.stubEnv("CLIENT_SECRET", "sk_test_revoked");
    await t.mutation(testAppRef.sync, {});
    await settle(t);
    const stopped = await status(t);
    expect(stopped.error?.kind).toBe("credentials");
    expect(stopped.cursor).toBe(before.cursor);
    const calls = fake.requests.length;
    expect(await t.mutation(testAppRef.sync, {})).toBe(false);
    await settle(t);
    expect(fake.requests.length).toBe(calls);

    vi.stubEnv("CLIENT_SECRET", fake.key);
    await quiesce(t);
    expect((await status(t)).error).toBeUndefined();
    expect(await copy(t)).toEqual(fake.snapshot());
  });

  it("rolls back a page whose callback throws, records the event, and replays it once fixed", async () => {
    const { t, fake } = setup();
    seed(fake);
    await quiesce(t);
    const before = await status(t);

    const broken = await t.run(
      async (ctx) => await ctx.db.insert("switches", { name: "boom" }),
    );
    const initech = fake.organization("Initech");
    await t.mutation(testAppRef.sync, {});
    await settle(t);
    const failed = await status(t);
    expect(failed.error).toMatchObject({ kind: "callback" });
    expect(failed.error?.event).toMatch(/^event_/);
    expect(failed.cursor).toBe(before.cursor);
    expect(
      await t.query(api.directory.organization, { workosId: initech }),
    ).toBeNull();

    await t.run(async (ctx) => await ctx.db.delete("switches", broken));
    await quiesce(t);
    expect((await status(t)).error).toBeUndefined();
    expect(await replica(t)).toEqual(expected(fake));
  });

  it("rides out 5xx and 429 with the lane backoff", async () => {
    const { t, fake } = setup();
    seed(fake);
    fake.fail(503, 2);
    fake.fail(429, 1);
    await quiesce(t);
    expect(await copy(t)).toEqual(fake.snapshot());
  });

  it("restarts from a fresh boundary when the cursor expires, tombstoning what was deleted in the gap", async () => {
    const { t, fake } = setup();
    const { globex, bob } = seed(fake);
    await quiesce(t);

    fake.deleteOrganization(globex);
    fake.deleteUser(bob);
    vi.setSystemTime(Date.now() + 91 * 24 * 60 * 60 * 1000);
    fake.organization("Later");
    fake.expire();
    await t.mutation(testAppRef.sync, {});
    await settle(t);
    expect((await status(t)).error?.kind).toBe("expired");

    await quiesce(t);
    expect(await copy(t)).toEqual(fake.snapshot());
    expect(await replica(t)).toEqual(expected(fake));
    expect((await status(t)).error).toBeUndefined();
  });

  it("never tombstones in reconcile a row the stream touched after the snapshot began", async () => {
    const { t, fake } = setup();
    seed(fake);
    // The stream applies this user before the listing, which was taken before the user existed.
    const late = fake.user("late@acme.test");
    intercept(fake, "/user_management/users", (body) => ({
      ...body,
      data: body.data.filter((item) => item.id !== late),
    }));
    await quiesce(t);
    expect((await copy(t)).users).toContain(late);
    expect(await copy(t)).toEqual(fake.snapshot());
  });

  it("routes an email to its organization and connection from the copy alone", async () => {
    const { t, fake } = setup();
    const { acme } = seed(fake);
    await quiesce(t);
    const calls = fake.requests.length;
    const connection = [...fake.connections.keys()][0];
    expect(
      await t.query(api.directory.route, { email: "Someone@ACME.test" }),
    ).toEqual({
      organization: acme,
      connection,
      sso: true,
    });
    expect(
      await t.query(api.directory.route, { email: "bob@globex.test" }),
    ).toBeNull();
    expect(
      await t.query(api.directory.route, { email: "x@nowhere.test" }),
    ).toBeNull();
    expect(fake.requests.length).toBe(calls);
  });

  it("routes past pending claims and inactive connections to the live ones", async () => {
    const { t, fake } = setup();
    // Twelve organizations claim the domain without verifying it.
    for (let index = 0; index < 12; index += 1) {
      fake.organization(`claimant ${index}`, [
        { domain: "initech.test", state: "pending" },
      ]);
    }
    const initech = fake.organization("Initech", [{ domain: "initech.test" }]);
    // Twenty-two old connections, all inactive, then the active one.
    for (let index = 0; index < 22; index += 1) {
      fake.deactivateConnection(fake.connection(initech));
    }
    const live = fake.connection(initech);
    await quiesce(t);

    expect(
      await t.query(api.directory.route, { email: "ada@initech.test" }),
    ).toEqual({ organization: initech, connection: live, sso: true });
  });

  it("pages memberships and group members from the copy", async () => {
    const { t, fake } = setup();
    const { acme, ada, staff } = seed(fake);
    await quiesce(t);
    const opts = { numItems: 10, cursor: null };
    const byUser = await t.query(api.directory.memberships, {
      of: { user: ada },
      paginationOpts: opts,
    });
    expect(byUser.page.map((row) => row.organization)).toEqual([acme]);
    const byOrg = await t.query(api.directory.memberships, {
      of: { organization: acme },
      paginationOpts: opts,
    });
    expect(byOrg.page).toHaveLength(1);
    const members = await t.query(api.directory.members, {
      group: staff,
      paginationOpts: opts,
    });
    expect(members.page).toHaveLength(2);
  });

  it("reports what is bound by fingerprint, never the secret", async () => {
    const { t, fake } = setup();
    const now = await status(t);
    expect(now.bound.clientId).toBe(fake.client);
    expect(now.bound.apiKey).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(now)).not.toContain(fake.key);
  });

  it("fails closed on a refused scoped listing: the copy stays, nothing is removed, the failure is recorded", async () => {
    const { t, fake } = setup();
    seed(fake);
    await quiesce(t);
    const held = await copy(t);
    const handed = await replica(t);

    vi.setSystemTime(Date.now() + 91 * 24 * 60 * 60 * 1000);
    fake.expire();
    fake.fail(404, 50, "/user_management/organization_memberships");
    fake.fail(422, 50, "/directory_groups");
    for (let tick = 0; tick < 8; tick += 1) {
      await t.mutation(testAppRef.sync, {});
      await settle(t);
    }

    expect((await status(t)).error).toMatchObject({ kind: "rejected" });
    expect(await copy(t)).toEqual(held);
    expect(await replica(t)).toEqual(handed);
  });

  it("keeps the boundary on a 4xx to a read from it, and records it", async () => {
    const { t, fake } = setup();
    seed(fake);
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    await quiesce(t);
    const before = await status(t);
    expect(before.cursor).toBeNull();
    fake.organization("Initech");
    fake.fail(400, 1, "/events");
    await t.mutation(testAppRef.sync, {});
    await settle(t);
    const after = await status(t);
    expect(after.error).toMatchObject({ kind: "rejected" });
    expect(after.cursor).toBe(before.cursor);
    expect(after.open).toBe(0);
    await quiesce(t);
    expect(await copy(t)).toEqual(fake.snapshot());
  });

  it("reads forward from a time boundary, so an endpoint that ignores `order` replays no history", async () => {
    const { t, fake } = setup();
    for (let index = 0; index < 150; index += 1)
      fake.organization(`old ${String(index)}`);
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    await quiesce(t);
    const reads = fake.requests.filter((request) => request.path === "/events");
    expect(reads.some((request) => request.search.includes("order="))).toBe(
      false,
    );
    expect(
      reads.some((request) => request.search.includes("range_start=")),
    ).toBe(true);
    expect((await status(t)).cursor).toBeNull();
    expect((await copy(t)).organizations).toHaveLength(150);

    const later = fake.organization("Later");
    await quiesce(t);
    expect((await status(t)).cursor).not.toBeNull();
    expect((await copy(t)).organizations).toContain(later);
  });

  it("mirrors domain events: created, failed verification in its own payload shape, and deleted", async () => {
    const { t, fake } = setup();
    const { acme } = seed(fake);
    await quiesce(t);
    const domain = fake.addDomain(acme, "acme.example");
    await quiesce(t);
    expect((await copy(t)).domains).toContain(domain);

    fake.failDomain(domain);
    await quiesce(t);
    const failed = (await rows(t, "domains")).find(
      (row) => row.workosId === domain,
    );
    expect(failed).toMatchObject({ state: "failed", deleted: false });

    fake.deleteDomain(domain);
    await quiesce(t);
    const gone = (await rows(t, "domains")).find(
      (row) => row.workosId === domain,
    );
    expect(gone).toMatchObject({ deleted: true });
    expect(await copy(t)).toEqual(fake.snapshot());
  });

  it("keeps one pass on the lane and one job per backfill however often it is swept", async () => {
    const { t, fake } = setup();
    seed(fake);
    // Past the seed's events, so only the listings open backfills and each runs exactly once.
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    const swept: boolean[] = [];
    for (let tick = 0; tick < 4; tick += 1)
      swept.push(await t.mutation(testAppRef.sync, {}));
    expect(swept).toEqual([true, false, false, false]);
    await settle(t);
    for (let round = 0; round < 3; round += 1) {
      for (let tick = 0; tick < 4; tick += 1)
        await t.mutation(testAppRef.sync, {});
      await settle(t);
    }
    await quiesce(t);
    const calls = (path: string) =>
      fake.requests.filter((request) => request.path === path).length;
    expect(calls("/organizations")).toBe(1);
    expect(calls("/user_management/users")).toBe(1);
    expect(calls("/user_management/organization_memberships")).toBe(2);
    expect(calls("/directory_users")).toBe(2);
    expect(calls("/directory_groups")).toBe(1);
    expect(await copy(t)).toEqual(fake.snapshot());

    fake.organization("Initech");
    const reads = calls("/events");
    expect(await t.mutation(testAppRef.sync, {})).toBe(true);
    expect(await t.mutation(testAppRef.sync, {})).toBe(false);
    await settle(t);
    expect(calls("/events")).toBe(reads + 1);
  });

  it("tombstones a deleted organization's domains, memberships and directories from its delete alone", async () => {
    const { t, fake } = setup();
    const { acme, globex } = seed(fake);
    await quiesce(t);

    // WorkOS empties the domains in an organization.updated, then sends organization.deleted with
    // no domains and no events for any child.
    fake.setDomains(acme, []);
    fake.deleteOrganization(acme);
    fake.deleteOrganization(globex);
    await quiesce(t);

    const held = async (
      table: "domains" | "memberships" | "connections" | "directories",
      organization: string,
    ) =>
      (await rows(t, table)).filter((row) => row.organization === organization);
    for (const organization of [acme, globex]) {
      for (const table of [
        "domains",
        "memberships",
        "connections",
        "directories",
      ] as const) {
        expect(
          (await held(table, organization)).every(
            (row) => row.deleted === true,
          ),
        ).toBe(true);
      }
    }
    expect((await held("domains", globex)).length).toBe(1);
    expect(await copy(t)).toEqual(fake.snapshot());
    expect(await replica(t)).toEqual(expected(fake));
  });

  it("passes over an event type it does not handle and keeps reading after it", async () => {
    const { t, fake } = setup();
    seed(fake);
    await quiesce(t);
    const initech = fake.organization("Initech");
    let injected = false;
    intercept(fake, "/events", (body) => {
      if (injected || body.data.length === 0) return body;
      injected = true;
      const unknown = {
        ...body.data[0],
        id: "event_unhandled",
        event: "session.created",
        data: {},
      };
      return { ...body, data: [unknown, ...body.data] };
    });
    await quiesce(t);
    expect(injected).toBe(true);
    expect((await status(t)).error).toBeUndefined();
    expect((await copy(t)).organizations).toContain(initech);
    expect(await copy(t)).toEqual(fake.snapshot());
  });

  it("restarts from a fresh boundary on any 4xx refusing the cursor", async () => {
    const { t, fake } = setup();
    seed(fake);
    await quiesce(t);
    fake.organization("Initech");
    await quiesce(t);
    expect((await status(t)).cursor).not.toBeNull();

    const hooli = fake.organization("Hooli");
    fake.fail(404, 1, "/events");
    await t.mutation(testAppRef.sync, {});
    await settle(t);
    const restarted = await status(t);
    expect(restarted.error?.kind).toBe("expired");
    expect(restarted.cursor).toBeNull();

    await quiesce(t);
    expect((await status(t)).error).toBeUndefined();
    expect((await copy(t)).organizations).toContain(hooli);
    expect(await copy(t)).toEqual(fake.snapshot());
  });

  it("tombstones the rows of an organization the mirror never held once it is gone", async () => {
    const { t, fake } = setup();
    const { ada } = seed(fake);
    await quiesce(t);
    // The organization's own events never reach the mirror; its children's do.
    intercept(fake, "/events", (body) => ({
      ...body,
      data: body.data.filter(
        (item) => !String(item.event).startsWith("organization."),
      ),
    }));
    const ghost = fake.organization("Ghost");
    const membership = fake.membership(ada, ghost);
    const connection = fake.connection(ghost);
    await t.mutation(testAppRef.sync, {});
    await settle(t);
    expect((await copy(t)).memberships).toContain(membership);
    expect((await copy(t)).connections).toContain(connection);
    expect((await copy(t)).organizations).not.toContain(ghost);

    // Deleted while the cursor was expired: no event for the delete is ever read.
    fake.deleteOrganization(ghost);
    vi.setSystemTime(Date.now() + 91 * 24 * 60 * 60 * 1000);
    fake.expire();
    await quiesce(t);
    expect((await copy(t)).memberships).not.toContain(membership);
    expect((await copy(t)).connections).not.toContain(connection);
    expect(await copy(t)).toEqual(fake.snapshot());
    expect(await replica(t)).toEqual(expected(fake));
  });

  it("runs one more pass for a sweep that arrives after a running pass made its last read", async () => {
    const { t, fake } = setup();
    seed(fake);
    await quiesce(t);
    let late: string | null = null;
    let swept: boolean | null = null;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await fake.fetch(input, init);
        if (
          late === null &&
          new URL(new Request(input, init).url).pathname === "/events"
        ) {
          late = fake.organization("Late");
          // Called from inside the component's running action, so named as the component names it.
          swept = await t.mutation(
            makeFunctionReference<"mutation">("stream:sweep"),
            {
              handles: {},
            },
          );
        }
        return response;
      },
    );
    expect(await t.mutation(testAppRef.sync, {})).toBe(true);
    await settle(t);
    expect(swept).toBe(false);
    expect(late).not.toBeNull();
    expect((await copy(t)).organizations).toContain(late);
    expect((await status(t)).pending).toBe(false);
  });

  it("restarts a stream that never saw an event once its boundary outlives the retention", async () => {
    const { t, fake } = setup();
    const { globex } = seed(fake);
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    await quiesce(t);
    expect((await status(t)).cursor).toBeNull();

    fake.deleteOrganization(globex);
    vi.setSystemTime(Date.now() + 91 * 24 * 60 * 60 * 1000);
    fake.expire();
    await quiesce(t);
    expect((await copy(t)).organizations).not.toContain(globex);
    expect(await copy(t)).toEqual(fake.snapshot());
    expect(await replica(t)).toEqual(expected(fake));
  });
});

// Every row of a copied table, tombstones included.
async function rows(
  t: Backend,
  table: "domains" | "memberships" | "connections" | "directories",
): Promise<Record<string, unknown>[]> {
  return await t.run(async (ctx) => await ctx.db.query(table).collect());
}
