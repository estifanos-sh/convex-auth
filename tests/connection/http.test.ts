import { api } from "@convex/_generated/api";
import schema from "@convex/schema";
import { ConvexError } from "convex/values";
import { expect, test } from "vite-plus/test";

import {
  addAuthRoutes,
  addOAuthProviderRoutes,
  addOpenIdRoutes,
  addConnectionRoutes,
  addWellKnownRoutes,
  convertErrorsToResponse,
} from "../../packages/auth/src/server/http";
import { convexTest } from "../convex/setup";

type RouteSpec = {
  method: string;
  path?: string;
  pathPrefix?: string;
};

function collectAuthRoutes() {
  const routes: RouteSpec[] = [];
  const router = {
    route: (spec: RouteSpec) => {
      routes.push({
        method: spec.method,
        path: spec.path,
        pathPrefix: spec.pathPrefix,
      });
    },
  };
  const ok = async () => new Response(null, { status: 204 });
  addOpenIdRoutes(router as never, {
    routeBase: "/auth",
    getIssuer: () => "https://example.com/auth",
    getJwks: () => "{}",
    oauth: { scopes: ["openid"] },
  });
  addWellKnownRoutes(router as never, {
    getResponse: () => ({ status: 200, body: "{}", headers: {} }),
  });
  addAuthRoutes(router as never, {
    routeBase: "/auth",
    handleSignIn: ok,
    handleCallback: ok,
  });
  addOAuthProviderRoutes(router as never, {
    routeBase: "/auth",
    handleAuthorize: ok,
    handleToken: ok,
    handleRegister: ok,
    handleManage: ok,
  });
  addConnectionRoutes(router as never, {
    routeBase: "/auth/connections",
    sharedOidcCallbackPath: "/auth/connection/oidc/callback",
    convertErrorsToResponse,
    handleSamlMetadata: ok as never,
    handleSamlSignIn: ok as never,
    handleOidcSignIn: ok as never,
    handleOidcCallback: ok as never,
    handleOidcSharedCallback: ok,
    handleSamlAcs: ok as never,
    handleSamlSlo: ok as never,
    handleScimRequest: ok,
    scimError: () => new Response(null, { status: 404 }),
  });
  return routes;
}

function routeSelector(route: RouteSpec) {
  return route.path ?? `${route.pathPrefix}*`;
}

function assertNoRouteCollisions(routes: RouteSpec[]) {
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const left = routes[i]!;
      const right = routes[j]!;
      if (left.method !== right.method) continue;
      const leftSelector = routeSelector(left);
      const rightSelector = routeSelector(right);
      const duplicate = leftSelector === rightSelector;
      const prefixCollision =
        left.pathPrefix !== undefined && right.path !== undefined
          ? right.path.startsWith(left.pathPrefix)
          : right.pathPrefix !== undefined && left.path !== undefined
            ? left.path.startsWith(right.pathPrefix)
            : left.pathPrefix !== undefined && right.pathPrefix !== undefined
              ? left.pathPrefix.startsWith(right.pathPrefix) ||
                right.pathPrefix.startsWith(left.pathPrefix)
              : false;
      expect(
        duplicate || prefixCollision,
        `${left.method} ${leftSelector} collides with ${right.method} ${rightSelector}`,
      ).toBe(false);
    }
  }
}

function parseJwtPayload(token: string): { sub?: string } {
  const payload = token.split(".")[1];
  if (!payload) {
    return {};
  }
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const json = atob(padded);
  return JSON.parse(json) as { sub?: string };
}

async function groupAdmin(t: any) {
  const result = (await t.action(api.auth.signIn, {
    provider: "anonymous",
  })) as {
    kind: string;
    session?: { token: string; refreshToken: string } | null;
  };
  if (result.kind !== "signedIn" || !result.session?.token) {
    throw new Error(`Expected signedIn with session token, got: ${JSON.stringify(result)}`);
  }
  const payload = parseJwtPayload(result.session.token);
  if (!payload.sub) {
    throw new Error(`Missing expected subject claim: ${JSON.stringify(payload)}`);
  }
  return t.withIdentity({ subject: payload.sub });
}

test("auth-owned HTTP route registrations are collision-free", () => {
  const routes = collectAuthRoutes();
  assertNoRouteCollisions(routes);
  expect(routes.map((route) => `${route.method} ${routeSelector(route)}`)).toEqual([
    "GET /auth/.well-known/openid-configuration",
    "GET /.well-known/openid-configuration",
    "GET /.well-known/oauth-authorization-server/auth",
    "GET /auth/.well-known/oauth-authorization-server",
    "GET /.well-known/oauth-authorization-server",
    "GET /auth/.well-known/jwks.json",
    "GET /.well-known/jwks.json",
    "OPTIONS /auth/.well-known/openid-configuration",
    "OPTIONS /.well-known/openid-configuration",
    "OPTIONS /.well-known/oauth-authorization-server/auth",
    "OPTIONS /auth/.well-known/oauth-authorization-server",
    "OPTIONS /.well-known/oauth-authorization-server",
    "OPTIONS /auth/.well-known/jwks.json",
    "OPTIONS /.well-known/jwks.json",
    "GET /.well-known/apple-app-site-association",
    "GET /.well-known/assetlinks.json",
    "GET /.well-known/webauthn",
    "GET /.well-known/change-password",
    "GET /.well-known/security.txt",
    "GET /auth/signin/*",
    "GET /auth/callback/*",
    "POST /auth/callback/*",
    "GET /auth/oauth2/authorize",
    "POST /auth/oauth2/token",
    "POST /auth/oauth2/register",
    "GET /auth/oauth2/register/*",
    "PUT /auth/oauth2/register/*",
    "DELETE /auth/oauth2/register/*",
    "OPTIONS /auth/oauth2/register/*",
    "OPTIONS /auth/oauth2/authorize",
    "OPTIONS /auth/oauth2/token",
    "OPTIONS /auth/oauth2/register",
    "GET /auth/connection/oidc/callback",
    "POST /auth/connection/oidc/callback",
    "GET /auth/connections/*",
    "POST /auth/connections/*",
    "PUT /auth/connections/*",
    "PATCH /auth/connections/*",
    "DELETE /auth/connections/*",
  ]);
});

test("group Connection control-plane HTTP endpoints are not exposed", async () => {
  const t = convexTest(schema);
  const response = await t.fetch("/api/auth/connection", {
    method: "POST",
    body: JSON.stringify({ name: "Should fail" }),
    headers: { "Content-Type": "application/json" },
  });

  expect([400, 404]).toContain(response.status);
});

test("group management RPC is available when group Connection helpers are mounted", async () => {
  const t = convexTest(schema);
  const asAdmin = await groupAdmin(t);
  const { groupId } = await asAdmin.mutation(api.groups.create, {
    name: "Mounted group Connection API group",
  });
  const created = await asAdmin.mutation(api.auth.group.createConnection, {
    groupId,
    name: "Mounted group Connection API",
    slug: "mounted-group-api",
    protocol: "saml",
    status: "active",
  });

  expect(created).toEqual(
    expect.objectContaining({
      connectionId: expect.any(String),
      groupId: expect.any(String),
    }),
  );

  await asAdmin.mutation(api.auth.group.removeConnection, {
    id: created.connectionId,
  });

  const metadataResponse = await t.fetch(`/connections/${created.connectionId}/saml/metadata`, {
    method: "GET",
  });
  expect([400, 404, 500]).toContain(metadataResponse.status);
});

test("group metadata query returns service provider setup values", async () => {
  const t = convexTest(schema);
  const asAdmin = await groupAdmin(t);
  const { groupId } = await asAdmin.mutation(api.groups.create, {
    name: "Mounted SAML metadata group",
  });
  const created = await asAdmin.mutation(api.auth.group.createConnection, {
    groupId,
    name: "Mounted saml metadata",
    slug: "mounted-saml-metadata",
    protocol: "saml",
    status: "active",
  });

  const metadata = await asAdmin.query(api.auth.group.metadata, {
    connectionId: created.connectionId,
  });

  expect(metadata).toContain("EntityDescriptor");
  expect(metadata).toContain(`/connections/${created.connectionId}/saml/metadata`);
  expect(metadata).toContain(`/connections/${created.connectionId}/saml/acs`);
  expect(metadata).toContain(`/connections/${created.connectionId}/saml/slo`);
});

test("disableWebhookEndpoint authorizes against the endpoint connection", async () => {
  const t = convexTest(schema);
  const asAdmin = await groupAdmin(t);
  const asOtherUser = await groupAdmin(t);
  const { groupId } = await asAdmin.mutation(api.groups.create, {
    name: "Webhook auth group",
  });

  const created = await asAdmin.mutation(api.auth.group.createConnection, {
    groupId,
    name: "Webhook auth",
    slug: "webhook-auth",
    protocol: "oidc",
    status: "active",
  });

  const endpoint = await asAdmin.mutation(api.auth.group.createWebhookEndpoint, {
    connectionId: created.connectionId,
    url: "https://example.com/webhook",
    secret: "super-secret",
    subscriptions: ["user.created"],
  });

  await expect(
    asOtherUser.mutation(api.auth.group.disableWebhookEndpoint, {
      id: endpoint._id,
    }),
  ).rejects.toThrow(ConvexError);

  const disabled = await asAdmin.mutation(api.auth.group.disableWebhookEndpoint, {
    id: endpoint._id,
  });

  expect(disabled).toEqual({ endpointId: endpoint._id });
});
