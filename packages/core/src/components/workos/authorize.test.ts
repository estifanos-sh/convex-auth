/**
 * The authorization URL WorkOS's `startSignIn` builds, run against WorkOS's
 * own component.
 *
 * @module
 */
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.ts";
import type { ComponentApi } from "./_generated/component.ts";
import schema from "./schema.ts";
import { workos, type WorkosRouting } from "../../methods/workos/server.ts";
import {
  ALLOWED_ORIGINS,
  asComponentApi,
  fakeCallbacks,
  fakeCore,
  testAuthorizationUrl,
} from "../../lib/oauth/componentContract.test.ts";

const modules = import.meta.glob("./**/*.ts");

const { startSignInWithWorkos } = workos(fakeCore, {
  component: asComponentApi<ComponentApi>(api),
  allowedRedirectOrigins: ALLOWED_ORIGINS,
}).attachUserCallbacks(fakeCallbacks);

testAuthorizationUrl(schema, modules, startSignInWithWorkos, {
  authorizationEndpoint: "https://api.workos.com/user_management/authorize",
  params: { provider: "authkit" },
});

const startSignIn = makeFunctionReference<
  "mutation",
  { redirectTo: string } & WorkosRouting,
  { redirect: string; state: string }
>("testApp:startSignIn");

const ORGANIZATION = "org_01HZX3K7Q9V5N2M8B4C6D0E1FG";
const CONNECTION = "conn_01HZX3K7Q9V5N2M8B4C6D0E1FG";

function routed() {
  vi.stubEnv("CLIENT_ID", "client_test");
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site/oauth/workos");
  return convexTest(schema, {
    ...modules,
    "./testApp.ts": async () => ({ startSignIn: startSignInWithWorkos }),
  });
}

async function authorizeParams(routing: WorkosRouting) {
  const { redirect } = await routed().mutation(startSignIn, {
    redirectTo: `${ALLOWED_ORIGINS[0]}/after`,
    ...routing,
  });
  return new URL(redirect).searchParams;
}

describe("routing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("sends an organization straight to its SSO connection", async () => {
    const params = await authorizeParams({ organizationId: ORGANIZATION });
    expect(params.get("organization_id")).toBe(ORGANIZATION);
    expect(params.get("provider")).toBeNull();
    expect(params.get("connection_id")).toBeNull();
  });

  test("sends a connection straight to it", async () => {
    const params = await authorizeParams({ connectionId: CONNECTION });
    expect(params.get("connection_id")).toBe(CONNECTION);
    expect(params.get("provider")).toBeNull();
  });

  test("passes the login and domain hints in any mode", async () => {
    const params = await authorizeParams({
      organizationId: ORGANIZATION,
      loginHint: "ada@example.com",
      domainHint: "Example.com",
    });
    expect(params.get("login_hint")).toBe("ada@example.com");
    expect(params.get("domain_hint")).toBe("example.com");
  });

  test("opens AuthKit on the screen asked for", async () => {
    const params = await authorizeParams({ screenHint: "sign-up" });
    expect(params.get("provider")).toBe("authkit");
    expect(params.get("screen_hint")).toBe("sign-up");
  });

  test.each([
    [
      "an organization id of the wrong shape",
      { organizationId: "org_1&provider=x" },
    ],
    ["a connection id of the wrong shape", { connectionId: "conn_short" }],
    [
      "an organization and a connection",
      { organizationId: ORGANIZATION, connectionId: CONNECTION },
    ],
    [
      "a screen hint outside AuthKit",
      { organizationId: ORGANIZATION, screenHint: "sign-in" as const },
    ],
    ["a login hint with whitespace", { loginHint: "ada @example.com" }],
    [
      "a domain hint that is not a domain",
      { domainHint: "https://example.com" },
    ],
  ])("refuses %s and records no request", async (_, routing: WorkosRouting) => {
    const t = routed();
    await expect(
      t.mutation(startSignIn, {
        redirectTo: `${ALLOWED_ORIGINS[0]}/after`,
        ...routing,
      }),
    ).rejects.toThrow();
    const requests = await t.run(
      async (ctx) => await ctx.db.query("authorizationRequests").collect(),
    );
    expect(requests).toHaveLength(0);
  });
});
