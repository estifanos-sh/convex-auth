import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.ts";
import schema from "./schema.ts";
import { testCallbackMethods } from "../../lib/oauth/componentContract.test.ts";
import { decryptTicketPayload } from "../../lib/oauth/crypto.ts";
import { sha256Hex } from "../../lib/crypto.ts";
import { OAUTH_CODE_PARAM, OAUTH_ERROR_PARAM } from "../../lib/oauthParams.ts";

/**
 * These tests cover WorkOS's token exchange and its profile request. Everything the callback shares with the other methods is covered
 * by the custom OAuth component's suite.
 */
const modules = import.meta.glob("./**/*.ts");

const REDIRECT_TO = "https://app.example.com/after";
const TOKEN_ENDPOINT = "https://api.workos.com/sso/token";
const PROFILE_ENDPOINT = "https://api.workos.com/sso/profile";

function setup() {
  vi.stubEnv("CLIENT_ID", "client_1");
  vi.stubEnv("CLIENT_SECRET", "sk_test_1");
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site/workos");
  return convexTest(schema, modules);
}

type FetchCall = { url: string; init: RequestInit };

function stubFetch(
  routes: Record<string, (init: RequestInit) => Response>,
): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const responder = routes[url];
      if (responder === undefined) {
        throw new Error(`Unexpected fetch: ${url}`);
      }
      calls.push({ url, init: init ?? {} });
      return responder(init ?? {});
    }),
  );
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const PROFILE = {
  object: "profile",
  id: "prof_1",
  idp_id: "00u1",
  organization_id: "org_1",
  connection_id: "conn_1",
  connection_type: "OktaSAML",
  email: "ada@example.com",
  first_name: "Ada",
  last_name: "Lovelace",
};

function workosRoutes() {
  return {
    [TOKEN_ENDPOINT]: () =>
      jsonResponse({
        token_type: "Bearer",
        access_token: "access-1",
        expires_in: 600,
        profile: PROFILE,
      }),
    [PROFILE_ENDPOINT]: () => jsonResponse(PROFILE),
  };
}

async function startFlow(t: ReturnType<typeof setup>): Promise<string> {
  const state = "state-raw-1";
  await t.mutation(api.provider.createAuthorizationRequest, {
    stateHash: await sha256Hex(state),
    redirectTo: REDIRECT_TO,
    codeVerifier: "verifier-1",
  });
  return state;
}

function redirectParams(response: Response): URLSearchParams {
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("Location") ?? "");
  expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_TO);
  return location.searchParams;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("workos callback", () => {
  test("exchanges the code with the API key and mints a ticket from the profile", async () => {
    const t = setup();
    const state = await startFlow(t);
    const calls = stubFetch(workosRoutes());
    const params = redirectParams(
      await t.fetch(
        `/callback?${new URLSearchParams({ state, code: "code-1" })}`,
      ),
    );
    const code = params.get(OAUTH_CODE_PARAM);
    expect(code).not.toBeNull();

    const exchange = calls.find((call) => call.url === TOKEN_ENDPOINT);
    const body = new URLSearchParams(String(exchange?.init.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_id")).toBe("client_1");
    expect(body.get("client_secret")).toBe("sk_test_1");
    expect(body.get("code")).toBe("code-1");

    const profileCall = calls.find((call) => call.url === PROFILE_ENDPOINT);
    expect(new Headers(profileCall?.init.headers).get("Authorization")).toBe(
      "Bearer access-1",
    );

    const ticket = await t.mutation(api.provider.claimTicket, {
      ticketCodeHash: await sha256Hex(code ?? ""),
      stateHash: await sha256Hex(state),
    });
    const payload: unknown = JSON.parse(
      await decryptTicketPayload(code ?? "", ticket?.encryptedPayload ?? ""),
    );
    expect(payload).toMatchObject({ userInfoResponses: { profile: PROFILE } });
  });

  test("a refused exchange redirects back with oauth_error", async () => {
    const t = setup();
    const state = await startFlow(t);
    stubFetch({
      ...workosRoutes(),
      [TOKEN_ENDPOINT]: () => jsonResponse({ error: "invalid_grant" }, 400),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const params = redirectParams(
      await t.fetch(
        `/callback?${new URLSearchParams({ state, code: "code-1" })}`,
      ),
    );
    expect(params.get(OAUTH_ERROR_PARAM)).toBe("oauth_error");
  });
});

testCallbackMethods(schema, modules);
