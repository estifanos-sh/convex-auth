import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.ts";
import schema from "./schema.ts";
import { testCallbackMethods } from "../../lib/oauth/componentContract.test.ts";
import { decryptTicketPayload } from "../../lib/oauth/crypto.ts";
import { sha256Hex } from "../../lib/crypto.ts";
import { OAUTH_CODE_PARAM, OAUTH_ERROR_PARAM } from "../../lib/oauthParams.ts";

/**
 * These tests cover the WorkOS-specific exchange: a JSON request, and the
 * user read from the token response. Everything the callback shares with the
 * other providers is covered by the custom-provider component's suite
 * (`../component/http.test.ts`), which exercises the same code.
 */
const modules = import.meta.glob("./**/*.ts");

const CLIENT_ID = "client_test";
const API_KEY = "sk_test_key";
const REDIRECT_TO = "https://app.example.com/after";
const TOKEN_ENDPOINT = "https://api.workos.com/user_management/authenticate";

function setup() {
  vi.stubEnv("CLIENT_ID", CLIENT_ID);
  vi.stubEnv("CLIENT_SECRET", API_KEY);
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site/oauth/workos");
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

/** What WorkOS's `authenticate` returns for a code. */
function authentication(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      object: "user",
      id: "user_01",
      email: "ada@example.com",
      email_verified: true,
      first_name: "Ada",
      last_name: "Lovelace",
      profile_picture_url: null,
    },
    organization_id: "org_01",
    authentication_method: "SSO",
    access_token: "workos-access-token",
    refresh_token: "workos-refresh-token",
    ...overrides,
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

function callback(
  t: ReturnType<typeof setup>,
  params: Record<string, string>,
): Promise<Response> {
  return t.fetch(`/callback?${new URLSearchParams(params)}`);
}

function redirectParams(response: Response): URLSearchParams {
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("Location")!);
  expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_TO);
  return location.searchParams;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("workos callback", () => {
  test("exchanges the code as JSON and mints a ticket from the token response", async () => {
    const t = setup();
    const state = await startFlow(t);
    const calls = stubFetch({
      [TOKEN_ENDPOINT]: () => jsonResponse(authentication()),
    });

    const params = redirectParams(await callback(t, { state, code: "code-1" }));
    const code = params.get(OAUTH_CODE_PARAM);
    expect(code).not.toBeNull();

    expect(calls).toHaveLength(1);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: API_KEY,
      code: "code-1",
      code_verifier: "verifier-1",
    });

    const ticket = await t.mutation(api.provider.claimTicket, {
      ticketCodeHash: await sha256Hex(code!),
      stateHash: await sha256Hex(state),
    });
    const payload = JSON.parse(
      await decryptTicketPayload(code!, ticket!.encryptedPayload),
    ) as { tokenResponse: Record<string, unknown> };
    expect(payload.tokenResponse).toEqual({
      user: authentication().user,
      organization_id: "org_01",
      authentication_method: "SSO",
    });
    // WorkOS's own session tokens never reach the ticket.
    expect(JSON.stringify(payload)).not.toContain("workos-access-token");
    expect(JSON.stringify(payload)).not.toContain("workos-refresh-token");
  });

  test("refuses an impersonated sign-in without minting a ticket", async () => {
    const t = setup();
    const state = await startFlow(t);
    stubFetch({
      [TOKEN_ENDPOINT]: () =>
        jsonResponse(
          authentication({
            impersonator: { email: "admin@example.com", reason: "support" },
          }),
        ),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const params = redirectParams(await callback(t, { state, code: "code-1" }));
    expect(params.get(OAUTH_CODE_PARAM)).toBeNull();
    expect(params.get(OAUTH_ERROR_PARAM)).toBe("oauth_error");
    const tickets = await t.run(
      async (ctx) => await ctx.db.query("tickets").collect(),
    );
    expect(tickets).toEqual([]);
  });

  test("refuses a token response with no user", async () => {
    const t = setup();
    const state = await startFlow(t);
    stubFetch({
      [TOKEN_ENDPOINT]: () => jsonResponse({ access_token: "a" }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const params = redirectParams(await callback(t, { state, code: "code-1" }));
    expect(params.get(OAUTH_ERROR_PARAM)).toBe("oauth_error");
  });

  test("sends a refused exchange back as oauth_error, logging only its code", async () => {
    const t = setup();
    const state = await startFlow(t);
    stubFetch({
      [TOKEN_ENDPOINT]: () =>
        jsonResponse(
          {
            code: "email_verification_required",
            message: "Email ownership must be verified.",
            email: "ada@example.com",
            pending_authentication_token: "pending-secret",
          },
          403,
        ),
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const params = redirectParams(await callback(t, { state, code: "code-1" }));
    expect(params.get(OAUTH_ERROR_PARAM)).toBe("oauth_error");
    const output = logged.mock.calls.flat().map(String).join(" ");
    expect(output).toContain("email_verification_required");
    expect(output).not.toContain("ada@example.com");
    expect(output).not.toContain("pending-secret");
  });

  test("passes a declined sign-in back as access_denied", async () => {
    const t = setup();
    const state = await startFlow(t);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const params = redirectParams(
      await callback(t, { state, error: "access_denied" }),
    );
    expect(params.get(OAUTH_ERROR_PARAM)).toBe("access_denied");
  });

  test("a replayed callback finds its flow already claimed", async () => {
    const t = setup();
    const state = await startFlow(t);
    const calls = stubFetch({
      [TOKEN_ENDPOINT]: () => jsonResponse(authentication()),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    redirectParams(await callback(t, { state, code: "code-1" }));
    const replay = await callback(t, { state, code: "code-1" });
    expect(replay.status).toBe(400);
    // The code is spent at WorkOS once.
    expect(calls).toHaveLength(1);
  });
});

testCallbackMethods(schema, modules);
