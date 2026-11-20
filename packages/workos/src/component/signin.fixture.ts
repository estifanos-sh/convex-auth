/**
 * What the sign-in tests share: the method set up on a stand-in for the core,
 * with host args, once as is and once with an app `provision` whose answer a
 * test picks, and a WorkOS sign-in run up to the code the callback redirects
 * back with.
 *
 * @module
 */
import { convexTest } from "convex-test";
import {
  internalMutationGeneric,
  makeFunctionReference,
  mutationGeneric,
} from "convex/server";
import { v } from "convex/values";
import { vi } from "vitest";
import type { AuthCore } from "@convex-dev/auth/server";
import { sha256Hex } from "@convex-dev/auth/lib/crypto";
import { OAUTH_CODE_PARAM } from "@convex-dev/auth/lib/oauthParams";
import { api } from "./_generated/api.ts";
import type { ComponentApi } from "./_generated/component.ts";
import schema from "./schema.ts";
import { json, modules, PROFILE } from "./workos.fixture.ts";
import type { CompleteSignInResult } from "@convex-dev/auth/lib/oauth/redemption";
import {
  setupWorkos,
  vWorkosProvision,
  vWorkosProvisionArgs,
  type WorkosAccount,
  type WorkosProvision,
  type WorkosSignInResult,
} from "../server.ts";

export const REDIRECT_TO = "https://app.example.com/after";
export const host = { siteId: v.string() };

type Account = WorkosAccount<typeof host>;
type Provision = { profile: { id: string }; host: { siteId: string } };

/**
 * What the app's `provision` was asked and answers, which a test sets, and
 * what the core was handed to sign up and sign in with.
 */
export const app = {
  asked: [] as Provision[],
  answer: { ready: true } as WorkosProvision,
  signedUp: [] as Account[],
  signedIn: [] as { userId: string; profile: Account }[],
  reset() {
    app.asked.length = 0;
    app.answer = { ready: true };
    app.signedUp.length = 0;
    app.signedIn.length = 0;
  },
};

function tokens(userId: string) {
  return {
    accessToken: "access",
    refreshToken: "refresh",
    refreshTokenExpiresAt: 0,
    userId,
  };
}

/**
 * A core whose helpers record the account, and sign a new one up as
 * `user_1`, standing in for the core's users and sessions, which this
 * package does not test.
 */
export const core = {
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
                completeSignUp: async (call: { profile: Account }) => {
                  app.signedUp.push(call.profile);
                  return tokens("user_1");
                },
                completeSignIn: async (call: {
                  userId: string;
                  profile: Account;
                }) => {
                  app.signedIn.push({
                    userId: call.userId,
                    profile: call.profile,
                  });
                  return tokens(call.userId);
                },
              },
            },
            args,
          ),
      }),
  }),
} as unknown as AuthCore<"users">;

const options = {
  component: api as unknown as ComponentApi,
  allowedRedirectOrigins: ["https://app.example.com"],
  args: host,
};
const createUser = makeFunctionReference<"mutation">(
  "testApp:createUser",
) as never;
const plain = setupWorkos(core, options).attachUserCallbacks({ createUser });
const provisioned = setupWorkos(core, options).attachProvisionedUserCallbacks({
  createUser,
  provision: makeFunctionReference<"mutation">("testApp:provision") as never,
});

export const testApp = {
  start: makeFunctionReference<
    "mutation",
    { redirectTo: string; siteId?: string },
    { redirect: string; state: string }
  >("testApp:start"),
  plain: makeFunctionReference<
    "mutation",
    { code: string; state: string; siteId?: string },
    CompleteSignInResult
  >("testApp:plain"),
  complete: makeFunctionReference<
    "mutation",
    { code: string; state: string; siteId?: string },
    WorkosSignInResult
  >("testApp:complete"),
  finish: makeFunctionReference<
    "mutation",
    { ticket: string },
    WorkosSignInResult
  >("testApp:finish"),
};

export function setup() {
  vi.stubEnv("CLIENT_ID", "client_1");
  vi.stubEnv("CLIENT_SECRET", "sk_test_1");
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site/workos");
  return convexTest(schema, {
    ...modules,
    "./testApp.ts": async () => ({
      start: plain.startSignInWithWorkos,
      plain: plain.completeSignInWithWorkos,
      complete: provisioned.completeSignInWithWorkos,
      finish: provisioned.finishSignInWithWorkos,
      provision: internalMutationGeneric({
        args: vWorkosProvisionArgs(host),
        returns: vWorkosProvision,
        handler: async (_ctx, asked) => {
          app.asked.push(asked);
          return app.answer;
        },
      }),
    }),
  });
}

/**
 * Run a sign-in through WorkOS's callback, and return the code it redirects
 * back with and the state that pairs with it.
 */
export async function authenticate(
  t: ReturnType<typeof setup>,
): Promise<{ code: string; state: string }> {
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
  return { code: location.searchParams.get(OAUTH_CODE_PARAM) ?? "", state };
}
