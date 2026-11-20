/**
 * The client of a host that provisions users (see
 * `attachProvisionedUserCallbacks` on the server): an ambient sign-in that starts a WorkOS flow, redeems the code
 * the callback redirects back with, keeps the ticket of a sign-in the app
 * deferred, and finishes it, adopting the session each time one is minted.
 *
 * It takes the place of `oauth()` in `ConvexAuthProvider`'s `ambientSignIns`,
 * since both would claim the callback's code. It runs on the SPA session
 * model only: its functions return a deferred sign-in, which the SSR proxy
 * does not forward.
 *
 * @module
 */
import {
  type FunctionArgs,
  type FunctionReference,
  getFunctionName,
  makeFunctionReference,
} from "convex/server";
import { convexToJson, jsonToConvex, type Value } from "convex/values";
import {
  OAUTH_CODE_PARAM,
  OAUTH_ERROR_PARAM,
} from "@convex-dev/auth/lib/oauthParams";
import type {
  OauthFlowError,
  OauthStartResult,
} from "@convex-dev/auth/methods/oauth/react";
import type { AmbientSignInClient } from "@convex-dev/auth/react/methods";
import type { WorkosSignInResult } from "./server.ts";

/** The functions a host that provisions users exports for its client. */
export type ProvisionedWorkosApi = {
  startSignInWithWorkos: FunctionReference<
    "mutation",
    "public",
    { redirectTo: string },
    { redirect: string; state: string }
  >;
  completeSignInWithWorkos: FunctionReference<
    "mutation",
    "public",
    { code: string; state: string },
    WorkosSignInResult
  >;
  finishSignInWithWorkos: FunctionReference<
    "mutation",
    "public",
    { ticket: string },
    WorkosSignInResult
  >;
};

/**
 * The host args a host's functions take besides their own, as declared in
 * `setupWorkos`'s `args`: the args of its finish other than `ticket`.
 */
export type WorkosHostArgs<Api extends ProvisionedWorkosApi> = Omit<
  FunctionArgs<Api["finishSignInWithWorkos"]>,
  "ticket"
> &
  HostValues;

/** The values of a host's host args, which every call carries. */
export type HostValues = Record<string, Value>;

/**
 * What redeeming a code, or finishing a deferred sign-in, resolves to: the
 * session was adopted, the app still provisions the user and `ticket`
 * finishes the sign-in later, or why it failed. It never rejects.
 */
export type WorkosCompleteResult =
  | { status: "complete" }
  | { status: "deferred"; ticket: string }
  | { status: "error"; userError: OauthFlowError };

/** The actions {@link workos} publishes for its hook to read. */
export type WorkosActions = {
  /**
   * Start a flow that returns to `redirectTo`. The flow keeps `host`, so the
   * redemption carries it too.
   */
  start: (
    api: ProvisionedWorkosApi,
    redirectTo: string,
    host: HostValues,
  ) => Promise<OauthStartResult>;
  /** Redeem a callback `code` against the saved flow. */
  redeem: (code: string) => Promise<WorkosCompleteResult>;
  /** Finish a sign-in the app deferred. */
  finish: (
    api: ProvisionedWorkosApi,
    ticket: string,
    host: HostValues,
  ) => Promise<WorkosCompleteResult>;
};

/** The id {@link workos} registers under. */
export const WORKOS_SETUP_ID = "workos";

/** Keys {@link workos} publishes its values under. */
export const WORKOS_KEYS = {
  actions: "actions",
  flowError: "flowError",
  deferredTicket: "deferredTicket",
} as const;

/** Storage key for the flow saved before navigating to WorkOS. */
const FLOW_KEY = "flow";

/** The flow error for an `error` the server callback put in the URL. */
function callbackFlowError(param: string): OauthFlowError {
  switch (param) {
    case "access_denied":
      return { error: "ACCESS_DENIED" };
    case "expired":
      return { error: "EXPIRED" };
    default:
      return { error: "OTHER_ERROR", cause: param };
  }
}

/**
 * The current page URL, or null where there is none. React Native defines
 * `window` but no `window.location`.
 */
export function currentHref(): string | null {
  if (typeof window === "undefined" || window.location === undefined) {
    return null;
  }
  return window.location.href;
}

/**
 * The client of a host that provisions users. Pass it to
 * `ConvexAuthProvider`'s `ambientSignIns`, without `oauth()`.
 */
export function workos(): AmbientSignInClient {
  return {
    id: WORKOS_SETUP_ID,
    setup: ({ client, values, storage, convex, replaceUrl }) => {
      const setFlowError = (flowError: OauthFlowError | null) =>
        values.set(WORKOS_KEYS.flowError, flowError);

      /**
       * Remove the saved flow after a callback error. A failed removal is
       * ignored, since the flow error already says why the sign-in ended.
       */
      const dropFlow = async () => {
        try {
          await storage.remove(FLOW_KEY);
        } catch {
          // The flow was already over.
        }
      };

      /** Adopt the session a redemption minted, or keep its ticket. */
      const adopt = async (
        result: WorkosSignInResult,
      ): Promise<WorkosCompleteResult> => {
        switch (result.status) {
          case "complete":
            values.set(WORKOS_KEYS.deferredTicket, null);
            await client.setSession(result.tokens);
            return { status: "complete" };
          case "deferred":
            values.set(WORKOS_KEYS.deferredTicket, result.ticket);
            return result;
          case "error":
            values.set(WORKOS_KEYS.deferredTicket, null);
            return { status: "error", userError: { error: "EXPIRED" } };
        }
      };

      /** Redeem a callback code against the saved flow. It never rejects. */
      const redeem = async (code: string): Promise<WorkosCompleteResult> => {
        try {
          const raw = await storage.get(FLOW_KEY);
          await storage.remove(FLOW_KEY);
          const flow: unknown = JSON.parse(raw ?? "null");
          if (
            typeof flow !== "object" ||
            flow === null ||
            !("state" in flow && typeof flow.state === "string") ||
            !("complete" in flow && typeof flow.complete === "string") ||
            !("host" in flow && typeof flow.host === "string")
          ) {
            return { status: "error", userError: { error: "INVALID_FLOW" } };
          }
          const host = jsonToConvex(JSON.parse(flow.host));
          if (
            typeof host !== "object" ||
            host === null ||
            Array.isArray(host) ||
            host instanceof ArrayBuffer
          ) {
            return { status: "error", userError: { error: "INVALID_FLOW" } };
          }
          const complete = makeFunctionReference<
            "mutation",
            { code: string; state: string },
            WorkosSignInResult
          >(flow.complete);
          return await adopt(
            await convex.mutation(complete, {
              ...host,
              code,
              state: flow.state,
            }),
          );
        } catch (cause) {
          return {
            status: "error",
            userError: { error: "OTHER_ERROR", cause },
          };
        }
      };

      const start: WorkosActions["start"] = async (api, redirectTo, host) => {
        setFlowError(null);
        try {
          const { redirect, state } = await convex.mutation(
            api.startSignInWithWorkos,
            { ...host, redirectTo },
          );
          await storage.set(
            FLOW_KEY,
            JSON.stringify({
              state,
              complete: getFunctionName(api.completeSignInWithWorkos),
              host: JSON.stringify(convexToJson(host)),
            }),
          );
          const url = new URL(redirect);
          if (currentHref() !== null && navigator.product !== "ReactNative") {
            window.location.href = url.toString();
          }
          return { status: "redirect", redirect: url };
        } catch (cause) {
          return {
            status: "error",
            userError: { error: "OTHER_ERROR", cause },
          };
        }
      };

      const finish: WorkosActions["finish"] = async (api, ticket, host) => {
        setFlowError(null);
        return await client.withSignInPending(async () => {
          try {
            return await adopt(
              await convex.mutation(api.finishSignInWithWorkos, {
                ...host,
                ticket,
              }),
            );
          } catch (cause) {
            return {
              status: "error",
              userError: { error: "OTHER_ERROR", cause },
            };
          }
        });
      };

      /**
       * Redeem the code the callback redirected back with. The params are
       * stripped from the URL before the first await, so a second run finds
       * a clean URL.
       */
      const onInit = () => {
        const href = currentHref();
        if (href === null) return;
        const url = new URL(href);
        const code = url.searchParams.get(OAUTH_CODE_PARAM);
        const error = url.searchParams.get(OAUTH_ERROR_PARAM);
        if (code === null && error === null) return;
        url.searchParams.delete(OAUTH_CODE_PARAM);
        url.searchParams.delete(OAUTH_ERROR_PARAM);
        replaceUrl(url.toString());
        if (error !== null) {
          void dropFlow();
          setFlowError(callbackFlowError(error));
          return;
        }
        if (code === null) return;
        void client.withSignInPending(async () => {
          const result = await redeem(code);
          if (result.status === "error") setFlowError(result.userError);
        });
      };

      values.set(WORKOS_KEYS.actions, {
        start,
        redeem: async (code) => {
          setFlowError(null);
          return await client.withSignInPending(() => redeem(code));
        },
        finish,
      } satisfies WorkosActions);
      values.set(WORKOS_KEYS.deferredTicket, null);
      setFlowError(null);
      return { onInit };
    },
  };
}
