/**
 * Host args: the args a host app passes to every call of the method's
 * functions, which both validate and the completing call hands to the
 * app's user callbacks.
 *
 * @module
 */
import { convexTest } from "convex-test";
import { makeFunctionReference, mutationGeneric } from "convex/server";
import { v } from "convex/values";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AuthCore } from "@convex-dev/auth/server";
import { sha256Hex } from "@convex-dev/auth/lib/crypto";
import { OAUTH_CODE_PARAM } from "@convex-dev/auth/lib/oauthParams";
import { api } from "./_generated/api.ts";
import type { ComponentApi } from "./_generated/component.ts";
import schema from "./schema.ts";
import { json, modules, PROFILE } from "./workos.fixture.ts";
import { addRoute } from "../routing.ts";
import { setupWorkos, type WorkosAccount } from "../server.ts";

const REDIRECT_TO = "https://app.example.com/after";
const host = { siteId: v.string() };

/** What the core was handed to sign in with. */
const signedIn: WorkosAccount<typeof host>[] = [];

const TOKENS = {
  accessToken: "access",
  refreshToken: "refresh",
  refreshTokenExpiresAt: 0,
  userId: "user_1",
};

/**
 * A core whose helpers record the profile, standing in for the core's
 * sessions, which this package does not test.
 */
const core = {
  bindMethod: () => ({
    authMutation: (fn: {
      args: Record<string, never>;
      returns?: never;
      handler: (ctx: object, args: object) => unknown;
    }) =>
      mutationGeneric({
        args: fn.args,
        returns: fn.returns,
        handler: (ctx, args) =>
          fn.handler(
            {
              ...ctx,
              convexAuth: {
                completeSignUp: async (call: {
                  profile: WorkosAccount<typeof host>;
                }) => {
                  signedIn.push(call.profile);
                  return TOKENS;
                },
              },
            },
            args,
          ),
      }),
  }),
} as unknown as AuthCore;

const { startSignInWithWorkos, completeSignInWithWorkos } = setupWorkos(core, {
  component: api as unknown as ComponentApi,
  allowedRedirectOrigins: ["https://app.example.com"],
  args: host,
}).attachUserCallbacks({} as never);

const start = makeFunctionReference<
  "mutation",
  { redirectTo: string; siteId?: string },
  { redirect: string; state: string }
>("testApp:start");
const complete = makeFunctionReference<
  "mutation",
  { code: string; state: string; siteId?: string },
  { status: string }
>("testApp:complete");

function setup() {
  vi.stubEnv("CLIENT_ID", "client_1");
  vi.stubEnv("CLIENT_SECRET", "sk_test_1");
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site/workos");
  return convexTest(schema, {
    ...modules,
    "./testApp.ts": async () => ({
      start: startSignInWithWorkos,
      complete: completeSignInWithWorkos,
    }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  signedIn.length = 0;
});

describe("host args", () => {
  const redirectTo = addRoute(REDIRECT_TO, {
    kind: "organization",
    organizationId: "org_1",
  });

  test("start validates them", async () => {
    const t = setup();
    await expect(t.mutation(start, { redirectTo })).rejects.toThrow(/siteId/);
    const { redirect } = await t.mutation(start, {
      redirectTo,
      siteId: "site_1",
    });
    expect(new URL(redirect).searchParams.get("organization")).toBe("org_1");
  });

  test("complete validates them, and hands them to the user callbacks", async () => {
    const t = setup();
    const state = "state-raw-1";
    await t.mutation(
      api.provider._internal_dangerous_createAuthorizationRequest,
      {
        stateHash: await sha256Hex(state),
        redirectTo: REDIRECT_TO,
        codeVerifier: "verifier-1",
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith("/sso/token")
          ? json({ token_type: "Bearer", access_token: "a", expires_in: 600 })
          : json(PROFILE),
      ),
    );
    const callback = await t.fetch(
      `/callback?${new URLSearchParams({ state, code: "code-1" })}`,
    );
    const location = new URL(callback.headers.get("Location") ?? "");
    const code = location.searchParams.get(OAUTH_CODE_PARAM) ?? "";

    await expect(t.mutation(complete, { code, state })).rejects.toThrow(
      /siteId/,
    );
    expect(
      await t.mutation(complete, { code, state, siteId: "site_1" }),
    ).toMatchObject({ status: "complete" });
    expect(signedIn).toEqual([
      expect.objectContaining({ id: "prof_1", host: { siteId: "site_1" } }),
    ]);
  });

  test("may not reuse an arg of the method's own", () => {
    expect(() =>
      setupWorkos(core, {
        component: api as unknown as ComponentApi,
        allowedRedirectOrigins: ["https://app.example.com"],
        args: { state: v.string() },
      }),
    ).toThrow(/state/);
  });
});
