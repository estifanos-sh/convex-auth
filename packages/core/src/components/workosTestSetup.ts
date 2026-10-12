// The WorkOS component's test setup: an in-memory WorkOS over `fetch`, and a
// test app whose handlers copy every change the directory sync makes.
import { convexTest, type TestConvex } from "convex-test";
import {
  type DataModelFromSchemaDefinition,
  defineSchema,
  defineTable,
  type GenericMutationCtx,
  internalMutationGeneric,
  anyApi,
  internalQueryGeneric,
  makeFunctionReference,
} from "convex/server";
import { ConvexError, type Infer, v } from "convex/values";
import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { vi } from "vitest";
import { api } from "./workos/_generated/api.ts";
import type { ComponentApi } from "./workos/_generated/component.ts";
import schema from "./workos/schema.ts";
import { matches } from "./workos/wire.ts";
import {
  type ChangeKind,
  vChangeKind,
  vConnectionChange,
  vDirectoryChange,
  vDirectoryGroupChange,
  vDirectoryMemberChange,
  vDirectoryUserChange,
  vMembershipChange,
  vOrganizationChange,
  vUserChange,
} from "./workos/changes.ts";
import { asComponentApi } from "../lib/oauth/componentContract.test.ts";
import { workosEnterprise } from "../methods/workos/server.ts";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const HOST = "api.workos.com";

type Json = Record<string, unknown>;

type Organization = {
  id: string;
  name: string;
  external_id: string | null;
  domains: {
    id: string;
    domain: string;
    state: string;
    organization_id: string;
    updated_at: string;
  }[];
  updated_at: string;
};
type User = {
  id: string;
  email: string;
  email_verified: boolean;
  first_name: string | null;
  last_name: string | null;
  profile_picture_url: string | null;
  external_id: string | null;
  updated_at: string;
};
type Membership = {
  id: string;
  user_id: string;
  organization_id: string;
  role: { slug: string };
  status: "active" | "inactive" | "pending";
  updated_at: string;
};
type Connection = {
  id: string;
  organization_id: string;
  connection_type: string;
  state: string;
  updated_at: string;
};
type Directory = {
  id: string;
  organization_id: string;
  name: string;
  type: string;
  state: string;
  updated_at: string;
};
type DirectoryUser = {
  id: string;
  directory_id: string;
  organization_id: string;
  idp_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  state: string;
  updated_at: string;
};
type Group = {
  id: string;
  directory_id: string;
  organization_id: string;
  name: string;
  updated_at: string;
};
type Event = { id: string; event: string; data: Json; created_at: string };
type Grant = {
  client: string;
  redirect: string;
  challenge: string;
  user: string;
  organization: string | null;
  method: string;
  impersonator: { email: string; reason: string | null } | null;
};
type Session = { id: string; user_id: string; status: "active" | "revoked" };

export type Snapshot = {
  organizations: string[];
  domains: string[];
  users: string[];
  memberships: string[];
  connections: string[];
  directories: string[];
  directoryUsers: string[];
  directoryGroups: string[];
  directoryMembers: string[];
};

const DomainData = v.array(
  v.object({ domain: v.string(), state: v.optional(v.string()) }),
);

function record(value: unknown): Json {
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function json(body: unknown, status: number, at: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      Date: new Date(at).toUTCString(),
    },
  });
}

async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

// An in-memory WorkOS over `fetch`: every mutation appends the event WorkOS would emit, the
// event log keeps 90 days and refuses a cursor it no longer holds, and the list endpoints enforce
// the filters WorkOS requires. Stub it with `vi.stubGlobal('fetch', fake.fetch)`.
export class FakeWorkOS {
  readonly organizations = new Map<string, Organization>();
  readonly users = new Map<string, User>();
  readonly memberships = new Map<string, Membership>();
  readonly connections = new Map<string, Connection>();
  readonly directories = new Map<string, Directory>();
  readonly directoryUsers = new Map<string, DirectoryUser>();
  readonly groups = new Map<string, Group>();
  readonly edges = new Map<
    string,
    { directory: string; group: string; user: string }
  >();
  readonly sessions = new Map<string, Session>();
  readonly requests: { method: string; path: string; search: string }[] = [];

  private events: Event[] = [];
  private readonly grants = new Map<string, Grant>();
  private readonly faults: { status: number; path?: string }[] = [];
  private counter = 0;
  private clock = 0;

  constructor(
    readonly key = "sk_test_fake",
    readonly client = "client_fake",
  ) {}

  // WorkOS stamps its responses and its events from one clock, so the Date header never trails
  // an event this fake has already timed.
  private reply(body: unknown, status = 200): Response {
    return json(body, status, Math.max(Date.now(), this.clock));
  }

  readonly fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => await this.handle(new Request(input, init));

  fail(status: number, times = 1, path?: string): void {
    for (let index = 0; index < times; index += 1)
      this.faults.push({ status, path });
  }

  private id(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${String(this.counter).padStart(8, "0")}`;
  }

  private now(): string {
    this.clock = Math.max(Date.now(), this.clock + 1);
    return new Date(this.clock).toISOString();
  }

  private emit(event: string, data: object): void {
    const created = this.now();
    this.events.push({
      id: this.id("event"),
      event,
      data: structuredClone({ ...data }),
      created_at: created,
    });
  }

  organization(
    name: string,
    domains: { domain: string; state?: string }[] = [],
  ): string {
    const id = this.id("org");
    const updated = this.now();
    const row: Organization = {
      id,
      name,
      external_id: null,
      domains: domains.map((item) => ({
        id: this.id("org_domain"),
        domain: item.domain,
        state: item.state ?? "verified",
        organization_id: id,
        updated_at: updated,
      })),
      updated_at: updated,
    };
    this.organizations.set(id, row);
    this.emit("organization.created", row);
    return id;
  }

  renameOrganization(id: string, name: string): void {
    const row = this.must(this.organizations, id);
    row.name = name;
    row.updated_at = this.now();
    this.emit("organization.updated", row);
  }

  setDomains(id: string, domains: { domain: string; state?: string }[]): void {
    const row = this.must(this.organizations, id);
    const updated = this.now();
    row.domains = domains.map((item) => ({
      id:
        row.domains.find((held) => held.domain === item.domain)?.id ??
        this.id("org_domain"),
      domain: item.domain,
      state: item.state ?? "verified",
      organization_id: id,
      updated_at: updated,
    }));
    row.updated_at = updated;
    this.emit("organization.updated", row);
  }

  addDomain(organization: string, name: string, state = "pending"): string {
    const row = this.must(this.organizations, organization);
    const updated = this.now();
    const item = {
      id: this.id("org_domain"),
      domain: name,
      state,
      organization_id: organization,
      updated_at: updated,
    };
    row.domains.push(item);
    this.emit("organization_domain.created", item);
    return item.id;
  }

  failDomain(id: string): void {
    const item = this.domainOf(id);
    item.state = "failed";
    item.updated_at = this.now();
    this.emit("organization_domain.verification_failed", {
      reason: "domain_verification_period_expired",
      organization_domain: { ...item },
    });
  }

  deleteDomain(id: string): void {
    const item = this.domainOf(id);
    const row = this.must(this.organizations, item.organization_id);
    row.domains = row.domains.filter((held) => held.id !== id);
    this.emit("organization_domain.deleted", item);
  }

  private domainOf(id: string) {
    for (const row of this.organizations.values()) {
      const item = row.domains.find((held) => held.id === id);
      if (item !== undefined) return item;
    }
    throw new Error(`FakeWorkOS: no ${id}`);
  }

  // Children of a deleted organization go without events of their own, as the mirror's cascade
  // has to tombstone them.
  deleteOrganization(id: string): void {
    const row = this.must(this.organizations, id);
    this.organizations.delete(id);
    for (const [key, item] of this.memberships)
      if (item.organization_id === id) this.memberships.delete(key);
    for (const [key, item] of this.connections)
      if (item.organization_id === id) this.connections.delete(key);
    for (const [key, item] of this.directories)
      if (item.organization_id === id) this.dropDirectory(key);
    this.emit("organization.deleted", row);
  }

  user(email: string, names: { first?: string; last?: string } = {}): string {
    const id = this.id("user");
    const row: User = {
      id,
      email,
      email_verified: true,
      first_name: names.first ?? null,
      last_name: names.last ?? null,
      profile_picture_url: null,
      external_id: null,
      updated_at: this.now(),
    };
    this.users.set(id, row);
    this.emit("user.created", row);
    return id;
  }

  renameUser(id: string, first: string): void {
    const row = this.must(this.users, id);
    row.first_name = first;
    row.updated_at = this.now();
    this.emit("user.updated", row);
  }

  deleteUser(id: string): void {
    const row = this.must(this.users, id);
    for (const [key, item] of this.memberships)
      if (item.user_id === id) this.deleteMembership(key);
    this.users.delete(id);
    this.emit("user.deleted", row);
  }

  membership(
    user: string,
    organization: string,
    role = "member",
    status: Membership["status"] = "active",
  ): string {
    this.must(this.users, user);
    this.must(this.organizations, organization);
    const id = this.id("om");
    const row: Membership = {
      id,
      user_id: user,
      organization_id: organization,
      role: { slug: role },
      status,
      updated_at: this.now(),
    };
    this.memberships.set(id, row);
    this.emit("organization_membership.created", row);
    return id;
  }

  updateMembership(
    id: string,
    change: { role?: string; status?: Membership["status"] },
  ): void {
    const row = this.must(this.memberships, id);
    if (change.role !== undefined) row.role = { slug: change.role };
    if (change.status !== undefined) row.status = change.status;
    row.updated_at = this.now();
    this.emit("organization_membership.updated", row);
  }

  deleteMembership(id: string): void {
    const row = this.must(this.memberships, id);
    this.memberships.delete(id);
    this.emit("organization_membership.deleted", row);
  }

  connection(organization: string, type = "OktaSAML"): string {
    this.must(this.organizations, organization);
    const id = this.id("conn");
    const row: Connection = {
      id,
      organization_id: organization,
      connection_type: type,
      state: "active",
      updated_at: this.now(),
    };
    this.connections.set(id, row);
    this.emit("connection.activated", row);
    return id;
  }

  deactivateConnection(id: string): void {
    const row = this.must(this.connections, id);
    row.state = "inactive";
    row.updated_at = this.now();
    this.emit("connection.deactivated", row);
  }

  deleteConnection(id: string): void {
    const row = this.must(this.connections, id);
    this.connections.delete(id);
    this.emit("connection.deleted", row);
  }

  directory(organization: string, name = "Okta"): string {
    this.must(this.organizations, organization);
    const id = this.id("directory");
    const row: Directory = {
      id,
      organization_id: organization,
      name,
      type: "okta scim v2.0",
      state: "active",
      updated_at: this.now(),
    };
    this.directories.set(id, row);
    this.emit("dsync.activated", row);
    return id;
  }

  deleteDirectory(id: string): void {
    const row = this.must(this.directories, id);
    this.dropDirectory(id);
    this.emit("dsync.deleted", row);
  }

  private dropDirectory(id: string): void {
    this.directories.delete(id);
    for (const [key, item] of this.directoryUsers)
      if (item.directory_id === id) this.directoryUsers.delete(key);
    for (const [key, item] of this.groups)
      if (item.directory_id === id) this.groups.delete(key);
    for (const [key, item] of this.edges)
      if (item.directory === id) this.edges.delete(key);
  }

  directoryUser(
    directory: string,
    email: string,
    names: { first?: string; last?: string } = {},
  ): string {
    const parent = this.must(this.directories, directory);
    const id = this.id("directory_user");
    const row: DirectoryUser = {
      id,
      directory_id: directory,
      organization_id: parent.organization_id,
      idp_id: `idp-${id}`,
      email,
      first_name: names.first ?? null,
      last_name: names.last ?? null,
      state: "active",
      updated_at: this.now(),
    };
    this.directoryUsers.set(id, row);
    this.emit("dsync.user.created", row);
    return id;
  }

  suspendDirectoryUser(id: string): void {
    const row = this.must(this.directoryUsers, id);
    row.state = "suspended";
    row.updated_at = this.now();
    this.emit("dsync.user.updated", row);
  }

  deleteDirectoryUser(id: string): void {
    const row = this.must(this.directoryUsers, id);
    this.directoryUsers.delete(id);
    for (const [key, item] of this.edges)
      if (item.user === id) this.edges.delete(key);
    this.emit("dsync.user.deleted", row);
  }

  group(directory: string, name: string): string {
    const parent = this.must(this.directories, directory);
    const id = this.id("directory_group");
    const row: Group = {
      id,
      directory_id: directory,
      organization_id: parent.organization_id,
      name,
      updated_at: this.now(),
    };
    this.groups.set(id, row);
    this.emit("dsync.group.created", row);
    return id;
  }

  renameGroup(id: string, name: string): void {
    const row = this.must(this.groups, id);
    row.name = name;
    row.updated_at = this.now();
    this.emit("dsync.group.updated", row);
  }

  deleteGroup(id: string): void {
    const row = this.must(this.groups, id);
    this.groups.delete(id);
    for (const [key, item] of this.edges)
      if (item.group === id) this.edges.delete(key);
    this.emit("dsync.group.deleted", row);
  }

  addToGroup(group: string, user: string): void {
    const parent = this.must(this.groups, group);
    const member = this.must(this.directoryUsers, user);
    this.edges.set(`${group}|${user}`, {
      directory: parent.directory_id,
      group,
      user,
    });
    this.emit("dsync.group.user_added", {
      directory_id: parent.directory_id,
      user: { ...member },
      group: { ...parent },
    });
  }

  removeFromGroup(group: string, user: string): void {
    const parent = this.must(this.groups, group);
    const member = this.must(this.directoryUsers, user);
    this.edges.delete(`${group}|${user}`);
    this.emit("dsync.group.user_removed", {
      directory_id: parent.directory_id,
      user: { ...member },
      group: { ...parent },
    });
  }

  // The browser's round trip through AuthKit: given the authorize URL the app built, the person
  // signs in as `user`, and WorkOS sends them back to the callback with a code.
  authorize(
    authorizeUrl: string,
    user: string,
    options: {
      organization?: string;
      method?: string;
      impersonator?: { email: string; reason?: string };
    } = {},
  ): string {
    const url = new URL(authorizeUrl);
    const client = url.searchParams.get("client_id") ?? "";
    const redirect = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const code = this.id("code");
    this.grants.set(code, {
      client,
      redirect,
      challenge: url.searchParams.get("code_challenge") ?? "",
      user,
      organization:
        options.organization ?? url.searchParams.get("organization_id"),
      method: options.method ?? "SSO",
      impersonator: options.impersonator
        ? {
            email: options.impersonator.email,
            reason: options.impersonator.reason ?? null,
          }
        : null,
    });
    const back = new URL(redirect);
    back.searchParams.set("code", code);
    back.searchParams.set("state", state);
    return back.toString();
  }

  expire(): void {
    const cutoff = Date.now() - RETENTION_MS;
    this.events = this.events.filter(
      (event) => Date.parse(event.created_at) >= cutoff,
    );
  }

  snapshot(): Snapshot {
    const ids = <T extends { id: string }>(rows: Map<string, T>) =>
      [...rows.keys()].sort();
    return {
      organizations: ids(this.organizations),
      domains: [...this.organizations.values()]
        .flatMap((row) => row.domains.map((item) => item.id))
        .sort(),
      users: ids(this.users),
      memberships: ids(this.memberships),
      connections: ids(this.connections),
      directories: ids(this.directories),
      directoryUsers: ids(this.directoryUsers),
      directoryGroups: ids(this.groups),
      directoryMembers: [...this.edges.keys()].sort(),
    };
  }

  private must<T>(rows: Map<string, T>, id: string): T {
    const row = rows.get(id);
    if (row === undefined) throw new Error(`FakeWorkOS: no ${id}`);
    return row;
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.host !== HOST)
      throw new TypeError(`FakeWorkOS: fetch to ${url.host}`);
    this.requests.push({
      method: request.method,
      path: url.pathname,
      search: url.search,
    });
    const index = this.faults.findIndex(
      (fault) => fault.path === undefined || fault.path === url.pathname,
    );
    if (index >= 0) {
      const [fault] = this.faults.splice(index, 1);
      return this.reply(
        { code: "injected", message: "injected" },
        fault?.status ?? 500,
      );
    }
    const body =
      request.method === "GET"
        ? {}
        : record(await request.json().catch(() => null));
    if (url.pathname === "/user_management/authenticate")
      return await this.authenticate(body);
    if (request.headers.get("Authorization") !== `Bearer ${this.key}`) {
      return this.reply(
        { code: "unauthorized", message: "Could not authorize the request." },
        401,
      );
    }
    const query = url.searchParams;
    const route = `${request.method} ${url.pathname}`;
    if (route === "GET /events") return this.list(this.eventsFor(query), query);
    if (route === "GET /organizations")
      return this.list([...this.organizations.values()], query);
    if (route === "GET /user_management/users")
      return this.list([...this.users.values()], query);
    if (route === "GET /user_management/organization_memberships") {
      const organization = query.get("organization_id");
      const user = query.get("user_id");
      if (organization === null && user === null)
        return this.reply({ code: "invalid" }, 422);
      const statuses = query.getAll("statuses[]");
      const wanted = statuses.length === 0 ? ["active"] : statuses;
      return this.list(
        [...this.memberships.values()].filter(
          (row) =>
            (organization === null || row.organization_id === organization) &&
            (user === null || row.user_id === user) &&
            wanted.includes(row.status),
        ),
        query,
      );
    }
    if (route === "GET /connections") {
      const organization = query.get("organization_id");
      return this.list(
        [...this.connections.values()].filter(
          (row) =>
            organization === null || row.organization_id === organization,
        ),
        query,
      );
    }
    if (route === "GET /directories") {
      const organization = query.get("organization_id");
      return this.list(
        [...this.directories.values()].filter(
          (row) =>
            organization === null || row.organization_id === organization,
        ),
        query,
      );
    }
    if (route === "GET /directory_users") {
      const directory = query.get("directory");
      const group = query.get("group");
      if (directory === null && group === null)
        return this.reply({ code: "invalid" }, 422);
      if (group !== null && !this.groups.has(group))
        return this.reply({ code: "not_found" }, 404);
      if (directory !== null && !this.directories.has(directory))
        return this.reply({ code: "not_found" }, 404);
      const members = new Set(
        [...this.edges.values()]
          .filter((edge) => edge.group === group)
          .map((edge) => edge.user),
      );
      return this.list(
        [...this.directoryUsers.values()].filter((row) =>
          group === null ? row.directory_id === directory : members.has(row.id),
        ),
        query,
      );
    }
    if (route === "GET /directory_groups") {
      const directory = query.get("directory");
      if (directory === null) return this.reply({ code: "invalid" }, 422);
      if (!this.directories.has(directory))
        return this.reply({ code: "not_found" }, 404);
      return this.list(
        [...this.groups.values()].filter(
          (row) => row.directory_id === directory,
        ),
        query,
      );
    }
    const sessions = /^GET \/user_management\/users\/([^/]+)\/sessions$/.exec(
      route,
    );
    if (sessions?.[1] !== undefined) {
      const user = decodeURIComponent(sessions[1]);
      return this.list(
        [...this.sessions.values()].filter((row) => row.user_id === user),
        query,
      );
    }
    if (route === "POST /user_management/sessions/revoke") {
      const session = this.sessions.get(String(body.session_id));
      if (session === undefined) return this.reply({ code: "not_found" }, 404);
      session.status = "revoked";
      return this.reply({});
    }
    if (route === "POST /portal/generate_link") {
      if (!this.organizations.has(String(body.organization)))
        return this.reply({ code: "not_found" }, 404);
      return this.reply({
        link: `https://setup.workos.com/portal/${String(body.intent)}/${this.id("link")}`,
      });
    }
    if (route === "POST /organizations") {
      const domains = matches(DomainData, body.domain_data)
        ? (body.domain_data as Infer<typeof DomainData>)
        : [];
      const id = this.organization(String(body.name), domains);
      return this.reply(this.must(this.organizations, id), 201);
    }
    const organization = /^PUT \/organizations\/([^/]+)$/.exec(route);
    if (organization?.[1] !== undefined) {
      const id = decodeURIComponent(organization[1]);
      if (!this.organizations.has(id))
        return this.reply({ code: "not_found" }, 404);
      if (typeof body.name === "string") this.renameOrganization(id, body.name);
      return this.reply(this.must(this.organizations, id));
    }
    if (route === "POST /user_management/organization_memberships") {
      const id = this.membership(
        String(body.user_id),
        String(body.organization_id),
        typeof body.role_slug === "string" ? body.role_slug : "member",
      );
      return this.reply(this.must(this.memberships, id), 201);
    }
    const membership =
      /^(PUT|DELETE) \/user_management\/organization_memberships\/([^/]+)$/.exec(
        route,
      );
    if (membership?.[2] !== undefined) {
      const id = decodeURIComponent(membership[2]);
      if (!this.memberships.has(id))
        return this.reply({ code: "not_found" }, 404);
      if (membership[1] === "DELETE") {
        this.deleteMembership(id);
        return new Response(null, {
          status: 202,
          headers: {
            Date: new Date(Math.max(Date.now(), this.clock)).toUTCString(),
          },
        });
      }
      this.updateMembership(id, { role: String(body.role_slug) });
      return this.reply(this.must(this.memberships, id));
    }
    return this.reply({ code: "not_found", message: route }, 404);
  }

  private eventsFor(query: URLSearchParams): Event[] | Response {
    const names = new Set(query.getAll("events"));
    if (names.size === 0)
      return this.reply(
        { code: "invalid", message: "events is required" },
        422,
      );
    const after = query.get("after");
    if (after !== null && !this.events.some((event) => event.id === after)) {
      return this.reply(
        { code: "invalid_cursor", message: "The after cursor is not valid" },
        400,
      );
    }
    const start = query.get("range_start");
    const since = start === null ? Number.NEGATIVE_INFINITY : Date.parse(start);
    return this.events.filter(
      (event) =>
        names.has(event.event) && Date.parse(event.created_at) >= since,
    );
  }

  private list<T extends { id: string }>(
    rows: T[] | Response,
    query: URLSearchParams,
  ): Response {
    if (rows instanceof Response) return rows;
    const limit = Math.min(100, Number(query.get("limit") ?? 10));
    const ordered = [...rows];
    const after = query.get("after");
    const start =
      after === null ? 0 : ordered.findIndex((row) => row.id === after) + 1;
    const anchor =
      after === null || start > 0
        ? start
        : ordered.findIndex((row) => row.id > after);
    const from = anchor < 0 ? ordered.length : anchor;
    const page = ordered.slice(from, from + limit);
    const more = from + limit < ordered.length;
    return this.reply({
      object: "list",
      data: page,
      list_metadata: {
        after: more ? (page.at(-1)?.id ?? null) : null,
        before: null,
      },
    });
  }

  private async authenticate(body: Json): Promise<Response> {
    const grant = this.grants.get(String(body.code));
    if (
      grant === undefined ||
      body.client_id !== this.client ||
      grant.client !== this.client ||
      body.client_secret !== this.key ||
      grant.challenge !== (await challenge(String(body.code_verifier)))
    ) {
      return this.reply(
        { error: "invalid_grant", error_description: "The code is not valid." },
        400,
      );
    }
    this.grants.delete(String(body.code));
    const user = this.must(this.users, grant.user);
    const session = this.id("session");
    this.sessions.set(session, {
      id: session,
      user_id: user.id,
      status: "active",
    });
    return this.reply({
      user,
      organization_id: grant.organization,
      access_token: `access.${session}`,
      refresh_token: `refresh.${session}`,
      authentication_method: grant.method,
      impersonator: grant.impersonator,
    });
  }
}

// ---------------------------------------------------------------------------
// The test app. The component runs at the root, as in the other component
// suites, with an app module beside it whose handlers copy every change into
// a `replica` table, so a test can compare what the app received with WorkOS.

export const testSchema = defineSchema({
  ...schema.tables,
  replica: defineTable({
    kind: vChangeKind,
    key: v.string(),
    deleted: v.boolean(),
  }).index("by_kind_key", ["kind", "key"]),
  switches: defineTable({ name: v.string() }).index("by_name", ["name"]),
});

type TestCtx = GenericMutationCtx<
  DataModelFromSchemaDefinition<typeof testSchema>
>;

// A constant amount of work per change, as the component asks of a handler.
// A `boom` switch makes every handler throw.
async function hold(
  ctx: TestCtx,
  kind: ChangeKind,
  key: string,
  removed: boolean,
): Promise<null> {
  const boom = await ctx.db
    .query("switches")
    .withIndex("by_name", (q) => q.eq("name", "boom"))
    .first();
  if (boom !== null) throw new ConvexError("the app handler is broken");
  const row = await ctx.db
    .query("replica")
    .withIndex("by_kind_key", (q) => q.eq("kind", kind).eq("key", key))
    .unique();
  if (row === null) {
    await ctx.db.insert("replica", { kind, key, deleted: removed });
  } else if (row.deleted !== removed) {
    await ctx.db.patch("replica", row._id, { deleted: removed });
  }
  return null;
}

const enterprise = workosEnterprise(asComponentApi<ComponentApi>(api), {
  on: {
    organization: anyApi.testApp.organization,
    membership: anyApi.testApp.membership,
    user: anyApi.testApp.user,
    connection: anyApi.testApp.connection,
    directory: anyApi.testApp.directory,
    directoryUser: anyApi.testApp.directoryUser,
    directoryGroup: anyApi.testApp.directoryGroup,
    directoryMember: anyApi.testApp.directoryMember,
  },
});

const removed = (change: { kind: "upsert" | "remove" }) =>
  change.kind === "remove";

const testApp = {
  organization: internalMutationGeneric({
    args: vOrganizationChange,
    handler: (ctx: TestCtx, c: Infer<typeof vOrganizationChange>) =>
      hold(ctx, "organization", c.after.workosId, removed(c)),
  }),
  membership: internalMutationGeneric({
    args: vMembershipChange,
    handler: (ctx: TestCtx, c: Infer<typeof vMembershipChange>) =>
      hold(ctx, "membership", c.after.workosId, removed(c)),
  }),
  user: internalMutationGeneric({
    args: vUserChange,
    handler: (ctx: TestCtx, c: Infer<typeof vUserChange>) =>
      hold(ctx, "user", c.after.workosId, removed(c)),
  }),
  connection: internalMutationGeneric({
    args: vConnectionChange,
    handler: (ctx: TestCtx, c: Infer<typeof vConnectionChange>) =>
      hold(ctx, "connection", c.after.workosId, removed(c)),
  }),
  directory: internalMutationGeneric({
    args: vDirectoryChange,
    handler: (ctx: TestCtx, c: Infer<typeof vDirectoryChange>) =>
      hold(ctx, "directory", c.after.workosId, removed(c)),
  }),
  directoryUser: internalMutationGeneric({
    args: vDirectoryUserChange,
    handler: (ctx: TestCtx, c: Infer<typeof vDirectoryUserChange>) =>
      hold(ctx, "directoryUser", c.after.workosId, removed(c)),
  }),
  directoryGroup: internalMutationGeneric({
    args: vDirectoryGroupChange,
    handler: (ctx: TestCtx, c: Infer<typeof vDirectoryGroupChange>) =>
      hold(ctx, "directoryGroup", c.after.workosId, removed(c)),
  }),
  directoryMember: internalMutationGeneric({
    args: vDirectoryMemberChange,
    handler: (ctx: TestCtx, c: Infer<typeof vDirectoryMemberChange>) =>
      hold(
        ctx,
        "directoryMember",
        `${c.after.group}|${c.after.user}`,
        removed(c),
      ),
  }),
  sync: internalMutationGeneric({
    args: {},
    handler: (ctx) => enterprise.sync(ctx),
  }),
  status: internalQueryGeneric({
    args: {},
    handler: (ctx) => enterprise.status(ctx),
  }),
};

export const testAppRef = {
  sync: makeFunctionReference<"mutation", Record<string, never>, boolean>(
    "testApp:sync",
  ),
  status: makeFunctionReference<
    "query",
    Record<string, never>,
    Awaited<ReturnType<typeof enterprise.status>>
  >("testApp:status"),
};

const modules = import.meta.glob("./workos/**/*.ts");

export const EPOCH = Date.UTC(2026, 9, 10, 12);
export type Backend = TestConvex<typeof testSchema>;

/**
 * A test backend over a fresh {@link FakeWorkOS}, at `start` on a fake clock.
 * The lane's retries and the workpool's polling run on timers, so the clock
 * moves only when a test settles.
 */
export function setup(options: { start?: number } = {}): {
  t: Backend;
  fake: FakeWorkOS;
} {
  vi.useFakeTimers();
  vi.clearAllTimers();
  vi.setSystemTime(options.start ?? EPOCH);
  for (const level of ["log", "info", "debug", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation(() => undefined);
  }
  const fake = new FakeWorkOS();
  vi.stubGlobal("fetch", fake.fetch);
  vi.stubEnv("CLIENT_ID", fake.client);
  vi.stubEnv("CLIENT_SECRET", fake.key);
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site/oauth/workos");
  const t = convexTest(testSchema, {
    ...modules,
    "./workos/testApp.ts": async () => testApp,
  });
  registerWorkpool(t, "lane");
  return { t, fake };
}

/**
 * Run scheduled work until nothing runs and no timer is left. The clock
 * moves only while nothing runs, one due time at a time.
 */
export async function settle(t: Backend): Promise<void> {
  for (;;) {
    await t.finishInProgressScheduledFunctions();
    if (vi.getTimerCount() === 0) return;
    await vi.advanceTimersToNextTimerAsync();
  }
}

export async function status(t: Backend) {
  return await t.query(testAppRef.status, {});
}

/**
 * The app's cron, run tick by tick until the sync reports no pass pending,
 * nothing open and no failure. Returns how many ticks it took.
 */
export async function quiesce(t: Backend, rounds = 400): Promise<number> {
  for (let round = 1; round <= rounds; round += 1) {
    await t.mutation(testAppRef.sync, {});
    await settle(t);
    const now = await status(t);
    if (!now.pending && now.open === 0 && now.error === undefined) {
      return round;
    }
  }
  throw new Error(`still pending, open or failed after ${rounds} syncs`);
}

const COPIED = [
  "organizations",
  "domains",
  "users",
  "memberships",
  "connections",
  "directories",
  "directoryUsers",
  "directoryGroups",
  "directoryMembers",
] as const;

/** The live rows of the copy, in the fake's terms. */
export async function copy(t: Backend): Promise<Snapshot> {
  return await t.run(async (ctx) => {
    const live = {} as Snapshot;
    for (const table of COPIED) {
      const rows: {
        deleted: boolean;
        workosId?: string;
        group?: string;
        user?: string;
      }[] = await ctx.db.query(table).collect();
      live[table] = rows
        .filter((row) => !row.deleted)
        .map((row) => row.workosId ?? `${row.group}|${row.user}`)
        .sort();
    }
    return live;
  });
}

/** What the app's handlers hold, in the fake's terms. */
export async function replica(t: Backend) {
  const rows = await t.run(
    async (ctx) => await ctx.db.query("replica").collect(),
  );
  const live = (kind: ChangeKind) =>
    rows
      .filter((row) => row.kind === kind && !row.deleted)
      .map((row) => row.key)
      .sort();
  return {
    organizations: live("organization"),
    users: live("user"),
    memberships: live("membership"),
    connections: live("connection"),
    directories: live("directory"),
    directoryUsers: live("directoryUser"),
    directoryGroups: live("directoryGroup"),
    directoryMembers: live("directoryMember"),
  };
}

/** What the app's handlers should hold: WorkOS, less the domains. */
export function expected(fake: FakeWorkOS) {
  const { domains: _domains, ...rest } = fake.snapshot();
  return rest;
}

// ---------------------------------------------------------------------------
// Interleavings: a seeded WorkOS, optionally synced first, then a sequence of
// WorkOS changes, syncs, clock moves and faults. The regression suite replays
// the ones that once broke the copy.

export const OPS = [
  "organization",
  "rename",
  "domains",
  "deleteOrganization",
  "addDomain",
  "failDomain",
  "deleteDomain",
  "user",
  "deleteUser",
  "renameUser",
  "membership",
  "updateMembership",
  "deleteMembership",
  "connection",
  "deactivate",
  "deleteConnection",
  "directory",
  "deleteDirectory",
  "directoryUser",
  "suspend",
  "deleteDirectoryUser",
  "group",
  "deleteGroup",
  "renameGroup",
  "add",
  "remove",
  "sync",
  "advance",
  "settle",
  "transient",
  "exhaust",
  "expire",
  "write",
] as const;

function pick<T>(rows: Map<string, T>, index: number): string | undefined {
  const keys = [...rows.keys()];
  return keys.length === 0 ? undefined : keys[index % keys.length];
}

function mutate(fake: FakeWorkOS, op: (typeof OPS)[number], n: number): void {
  const organization = pick(fake.organizations, n);
  const user = pick(fake.users, n);
  const directory = pick(fake.directories, n);
  const member = pick(fake.directoryUsers, n);
  const group = pick(fake.groups, n);
  switch (op) {
    case "organization":
      fake.organization(`org ${String(n)}`, [{ domain: `d${String(n)}.test` }]);
      return;
    case "rename":
      if (organization)
        fake.renameOrganization(organization, `renamed ${String(n)}`);
      return;
    case "domains":
      if (organization)
        fake.setDomains(organization, [
          { domain: `e${String(n)}.test`, state: "pending" },
        ]);
      return;
    case "deleteOrganization":
      if (organization) fake.deleteOrganization(organization);
      return;
    case "addDomain":
      if (organization) fake.addDomain(organization, `a${String(n)}.test`);
      return;
    case "failDomain":
    case "deleteDomain": {
      const held = [...fake.organizations.values()].flatMap(
        (row) => row.domains,
      );
      const domain = held[n % Math.max(1, held.length)];
      if (domain === undefined) return;
      if (op === "failDomain") fake.failDomain(domain.id);
      else fake.deleteDomain(domain.id);
      return;
    }
    case "user":
      fake.user(`u${String(n)}@x.test`);
      return;
    case "deleteUser":
      if (user) fake.deleteUser(user);
      return;
    case "renameUser":
      if (user) fake.renameUser(user, `renamed ${String(n)}`);
      return;
    case "membership":
      if (user && organization)
        fake.membership(
          user,
          organization,
          "member",
          n % 2 === 0 ? "active" : "pending",
        );
      return;
    case "updateMembership": {
      const id = pick(fake.memberships, n);
      if (id)
        fake.updateMembership(id, {
          role: `r${String(n)}`,
          status: "inactive",
        });
      return;
    }
    case "deleteMembership": {
      const id = pick(fake.memberships, n);
      if (id) fake.deleteMembership(id);
      return;
    }
    case "connection":
      if (organization) fake.connection(organization);
      return;
    case "deactivate": {
      const id = pick(fake.connections, n);
      if (id) fake.deactivateConnection(id);
      return;
    }
    case "deleteConnection": {
      const id = pick(fake.connections, n);
      if (id) fake.deleteConnection(id);
      return;
    }
    case "directory":
      if (organization) fake.directory(organization);
      return;
    case "deleteDirectory":
      if (directory) fake.deleteDirectory(directory);
      return;
    case "directoryUser":
      if (directory) fake.directoryUser(directory, `p${String(n)}@x.test`);
      return;
    case "suspend":
      if (member) fake.suspendDirectoryUser(member);
      return;
    case "deleteDirectoryUser":
      if (member) fake.deleteDirectoryUser(member);
      return;
    case "group":
      if (directory) fake.group(directory, `g${String(n)}`);
      return;
    case "deleteGroup":
      if (group) fake.deleteGroup(group);
      return;
    case "renameGroup":
      if (group) fake.renameGroup(group, `renamed ${String(n)}`);
      return;
    case "add": {
      const parent = group === undefined ? undefined : fake.groups.get(group);
      const candidate = [...fake.directoryUsers.values()].find(
        (row) => row.directory_id === parent?.directory_id,
      );
      if (group && candidate) fake.addToGroup(group, candidate.id);
      return;
    }
    case "remove": {
      const edge = pick(fake.edges, n);
      const held = edge === undefined ? undefined : fake.edges.get(edge);
      if (held) fake.removeFromGroup(held.group, held.user);
      return;
    }
    default:
      return;
  }
}

export type Op = (typeof OPS)[number];

async function step(
  t: Backend,
  fake: FakeWorkOS,
  op: Op,
  n: number,
): Promise<void> {
  switch (op) {
    case "sync":
      await t.mutation(testAppRef.sync, {});
      break;
    case "advance":
      if (vi.getTimerCount() > 0) await vi.advanceTimersToNextTimerAsync();
      await t.finishInProgressScheduledFunctions();
      break;
    case "settle":
      await settle(t);
      break;
    case "transient":
      fake.fail(n % 2 === 0 ? 503 : 429, 1 + (n % 3));
      break;
    case "exhaust":
      fake.fail(500, 5);
      await t.mutation(testAppRef.sync, {});
      await settle(t);
      break;
    case "write":
      // An organization created at WorkOS, then a sync, as an admin write does.
      fake.organization(`w${String(n)}`, []);
      await t.mutation(testAppRef.sync, {});
      break;
    case "expire":
      // The jump stands for 91 idle days; a jump under in-flight lane timers would
      // make the workpool's poll walk the whole gap.
      await settle(t);
      vi.setSystemTime(Date.now() + 91 * 24 * 60 * 60 * 1000);
      fake.expire();
      break;
    default:
      mutate(fake, op, n);
  }
}

// One interleaving: a seeded world, optionally mirrored first, then each step in order.
export async function play(
  world: number,
  warm: boolean,
  steps: readonly (readonly [Op, number])[],
  offset = 0,
) {
  const { t, fake } = setup({ start: EPOCH + offset });
  for (let index = 0; index < world; index += 1) {
    const organization = fake.organization(`seed ${String(index)}`, [
      { domain: `s${String(index)}.test` },
    ]);
    const user = fake.user(`s${String(index)}@x.test`);
    fake.membership(user, organization);
    fake.connection(organization);
    const directory = fake.directory(organization);
    const person = fake.directoryUser(directory, `q${String(index)}@x.test`);
    const group = fake.group(directory, `team ${String(index)}`);
    fake.addToGroup(group, person);
  }
  if (warm) await quiesce(t);
  for (const [op, n] of steps) await step(t, fake, op, n);
  await settle(t);
  await quiesce(t);
  return { t, fake };
}
