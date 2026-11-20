/**
 * What the tests of the component share: WorkOS's payloads as its API sends
 * them, with fields the copy does not read and `null`s, and a stub of
 * WorkOS's API.
 *
 * @module
 */
import { convexTest } from "convex-test";
import { vi } from "vitest";
import schema from "./schema.ts";

export const modules = import.meta.glob("./**/*.ts");

export function setup() {
  vi.stubEnv("CLIENT_ID", "client_1");
  vi.stubEnv("CLIENT_SECRET", "sk_test_1");
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site/workos");
  return convexTest(schema, modules);
}

const STAMPS = {
  created_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-02T00:00:00.000Z",
};

export const ORGANIZATION = {
  object: "organization",
  id: "org_1",
  name: "Acme",
  allow_profiles_outside_organization: false,
  external_id: null,
  metadata: {},
  domains: [
    {
      object: "organization_domain",
      id: "org_domain_1",
      domain: "Acme.com",
      state: "verified",
      verification_strategy: "dns",
    },
  ],
  ...STAMPS,
};

export const DOMAIN = {
  object: "organization_domain",
  id: "org_domain_1",
  organization_id: "org_1",
  domain: "acme.com",
  state: "verified",
  verification_strategy: "dns",
  verification_token: "token",
  ...STAMPS,
};

export const CONNECTION = {
  object: "connection",
  id: "conn_1",
  organization_id: "org_1",
  name: "Okta",
  connection_type: "OktaSAML",
  state: "active",
  domains: [],
  ...STAMPS,
};

export const DIRECTORY = {
  object: "directory",
  id: "directory_1",
  organization_id: "org_1",
  name: "Okta SCIM",
  type: "okta scim v2.0",
  state: "linked",
  external_key: "key",
  domain: "acme.com",
  metadata: { users: { active: 1, inactive: 0 }, groups: 1 },
  ...STAMPS,
};

export const USER = {
  object: "directory_user",
  id: "directory_user_1",
  directory_id: "directory_1",
  organization_id: "org_1",
  idp_id: "00u1",
  email: "Ada@Acme.com",
  first_name: "Ada",
  last_name: null,
  name: null,
  state: "active",
  role: { slug: "member" },
  roles: [{ slug: "member" }],
  raw_attributes: { department: "Engineering" },
  custom_attributes: {},
  ...STAMPS,
};

export const GROUP = {
  object: "directory_group",
  id: "directory_group_1",
  directory_id: "directory_1",
  organization_id: "org_1",
  idp_id: "group_1",
  name: "Staff",
  raw_attributes: {},
  ...STAMPS,
};

export const PROFILE = {
  object: "profile",
  id: "prof_1",
  idp_id: "00u1",
  organization_id: "org_1",
  connection_id: "conn_1",
  connection_type: "OktaSAML",
  email: "ada@acme.com",
  first_name: "Ada",
  last_name: null,
  role: null,
  raw_attributes: { department: "Engineering" },
};

/** Each event name the copy applies, with a payload WorkOS sends for it. */
export const PAYLOADS: Record<string, object> = {
  "organization.created": ORGANIZATION,
  "organization.updated": ORGANIZATION,
  "organization.deleted": ORGANIZATION,
  "organization_domain.created": DOMAIN,
  "organization_domain.updated": DOMAIN,
  "organization_domain.verified": DOMAIN,
  "organization_domain.verification_failed": {
    reason: "domain_verification_period_expired",
    organization_domain: { ...DOMAIN, state: "failed" },
  },
  "organization_domain.deleted": DOMAIN,
  "connection.activated": CONNECTION,
  "connection.deactivated": { ...CONNECTION, state: "inactive" },
  "connection.deleted": CONNECTION,
  "dsync.activated": {
    ...DIRECTORY,
    state: "active",
    domains: [{ object: "organization_domain", id: "d", domain: "acme.com" }],
  },
  "dsync.deleted": { ...DIRECTORY, state: "deleting" },
  "dsync.user.created": USER,
  "dsync.user.updated": { ...USER, previous_attributes: { first_name: "A" } },
  "dsync.user.deleted": USER,
  "dsync.group.created": GROUP,
  "dsync.group.updated": { ...GROUP, previous_attributes: {} },
  "dsync.group.deleted": GROUP,
  "dsync.group.user_added": {
    directory_id: "directory_1",
    user: USER,
    group: GROUP,
  },
  "dsync.group.user_removed": {
    directory_id: "directory_1",
    user: USER,
    group: GROUP,
  },
};

let sequence = 0;

/** An event as `/events` lists it. */
export function event(name: string, data: object = PAYLOADS[name] ?? {}) {
  sequence += 1;
  return {
    object: "event",
    id: `event_${String(sequence).padStart(4, "0")}`,
    event: name,
    data,
    created_at: "2026-11-03T00:00:00.000Z",
  };
}

/** A page as WorkOS's list endpoints send it. */
export function list(data: object[], after: string | null = null) {
  return { object: "list", data, list_metadata: { before: null, after } };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Stub `fetch` with `answer`, and return the requests it got. */
export function stubFetch(
  answer: (url: URL, init: RequestInit) => Response,
): { url: URL; init: RequestInit }[] {
  const calls: { url: URL; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      calls.push({ url, init: init ?? {} });
      return answer(url, init ?? {});
    }),
  );
  return calls;
}
