// @vitest-environment jsdom
/**
 * The client of a host that provisions users: a code that redeems to a
 * deferred sign-in keeps its ticket, and a finish adopts the session.
 *
 * @module
 */
import { getFunctionName, makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AuthClient, InMemoryStorage } from "@convex-dev/auth/browser";
import type { AuthSignInApi } from "@convex-dev/auth/react/methods";
import type { ExposedSignInFn } from "@convex-dev/auth/ssr";
import {
  type HostValues,
  type ProvisionedWorkosApi,
  workos,
  type WorkosActions,
  WORKOS_KEYS,
  WORKOS_SETUP_ID,
} from "./client.ts";

const api: ProvisionedWorkosApi = {
  startSignInWithWorkos: makeFunctionReference("auth:startSignInWithWorkos"),
  completeSignInWithWorkos: makeFunctionReference(
    "auth:completeSignInWithWorkos",
  ),
  finishSignInWithWorkos: makeFunctionReference("auth:finishSignInWithWorkos"),
};

const complete = {
  status: "complete",
  tokens: {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    refreshTokenExpiresAt: 0,
    userId: "user_1",
  },
};
const deferred = { status: "deferred", ticket: "ticket-1" };

/**
 * A client with only `workos()` registered, whose Convex mutations answer
 * from `answers`, keyed by function path, in order.
 */
function setup(answers: Record<string, unknown[]>) {
  const queues = new Map(
    Object.entries(answers).map(([path, queue]) => [path, [...queue]]),
  );
  const mutation = vi.fn(async (fn: never, _args: unknown) => {
    const answer = queues.get(getFunctionName(fn))?.shift();
    if (answer === undefined) throw new Error("unexpected call");
    return answer;
  });
  const client = new AuthClient({
    mode: "spa",
    authApi: {
      refreshSession: async () => ({ kind: "noSession" as const }),
      signOut: async () => {},
    },
    storage: new InMemoryStorage(),
    storageNamespace: "https://happy-animal-123.convex.cloud",
    ambientSignIns: {
      signIns: [workos()],
      signInApi: { mutation, action: vi.fn() } as unknown as AuthSignInApi,
      convex: { mutation },
    },
  });
  const values = client.ambientSignInValues(WORKOS_SETUP_ID);
  return {
    client,
    mutation,
    actions: values.get<WorkosActions>(WORKOS_KEYS.actions)!,
    flowError: () => values.get(WORKOS_KEYS.flowError),
    deferredTicket: () => values.get(WORKOS_KEYS.deferredTicket),
  };
}

/** Start a flow, as the page before the redirect does. */
async function start(actions: WorkosActions, host: HostValues = {}) {
  Object.defineProperty(window.navigator, "product", {
    value: "ReactNative",
    configurable: true,
  });
  await actions.start(api, "https://app.example.com/after", host);
  delete (window.navigator as { product?: string }).product;
}

const START = {
  "auth:startSignInWithWorkos": [
    { redirect: "https://api.workos.com/sso/authorize", state: "state-1" },
  ],
};

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("WorkOS client", () => {
  test("a code that redeems to a deferred sign-in publishes its ticket", async () => {
    const { client, mutation, actions, flowError, deferredTicket } = setup({
      ...START,
      "auth:completeSignInWithWorkos": [deferred],
    });
    await start(actions);
    window.history.replaceState(null, "", "/?convexAuthCode=code-1");

    await client.init();

    await vi.waitFor(() => expect(deferredTicket()).toBe("ticket-1"));
    expect(mutation.mock.calls[1]![1]).toEqual({
      code: "code-1",
      state: "state-1",
    });
    expect(client.getSnapshot().isAuthenticated).toBe(false);
    expect(flowError()).toBeNull();
    expect(window.location.search).toBe("");
  });

  test("a finish before provisioning keeps the ticket, and after adopts the session", async () => {
    const { client, actions, deferredTicket } = setup({
      "auth:finishSignInWithWorkos": [deferred, complete],
    });

    expect(await actions.finish(api, "ticket-1", {})).toEqual(deferred);
    expect(deferredTicket()).toBe("ticket-1");
    expect(await actions.finish(api, "ticket-1", {})).toEqual({
      status: "complete",
    });
    expect(client.getSnapshot().isAuthenticated).toBe(true);
    expect(deferredTicket()).toBeNull();
  });

  test("a host's host args reach the start, the redemption and the finish", async () => {
    const { client, mutation, actions } = setup({
      ...START,
      "auth:completeSignInWithWorkos": [deferred],
      "auth:finishSignInWithWorkos": [complete],
    });
    const host = { siteId: "site_1", seats: 2n };
    await start(actions, host);
    window.history.replaceState(null, "", "/?convexAuthCode=code-1");
    await client.init();
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));

    expect(await actions.finish(api, "ticket-1", host)).toEqual({
      status: "complete",
    });
    expect(mutation.mock.calls.map(([, args]) => args)).toEqual([
      { ...host, redirectTo: "https://app.example.com/after" },
      { ...host, code: "code-1", state: "state-1" },
      { ...host, ticket: "ticket-1" },
    ]);
  });

  test("a spent ticket is EXPIRED and clears it", async () => {
    const { actions, deferredTicket } = setup({
      "auth:finishSignInWithWorkos": [
        { status: "error", userError: { error: "INVALID_CODE" } },
      ],
    });
    expect(await actions.finish(api, "ticket-1", {})).toEqual({
      status: "error",
      userError: { error: "EXPIRED" },
    });
    expect(deferredTicket()).toBeNull();
  });

  test("a code with no saved flow is INVALID_FLOW", async () => {
    const { client, flowError } = setup({});
    window.history.replaceState(null, "", "/?convexAuthCode=code-1");
    await client.init();
    await vi.waitFor(() =>
      expect(flowError()).toEqual({ error: "INVALID_FLOW" }),
    );
  });

  test("the SSR proxy's allowlist refuses its functions", () => {
    const allowlist: ExposedSignInFn[] = [
      // @ts-expect-error A deferred sign-in is not the shared envelope the
      // proxy forwards, so a host that provisions users runs on the SPA model.
      api.completeSignInWithWorkos,
      // @ts-expect-error The same holds for the finish.
      api.finishSignInWithWorkos,
    ];
    expect(allowlist).toHaveLength(2);
  });
});
