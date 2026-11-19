/**
 * The `workos` sign-in method, exported at
 * `@convex-dev/auth/methods/workos/server`: enterprise SSO through WorkOS,
 * and the directory sync that mirrors the customers' SCIM directories.
 *
 * @module
 */
import {
  createFunctionHandle,
  internalActionGeneric,
  internalMutationGeneric,
  makeFunctionReference,
  mutationGeneric,
  type GenericDataModel,
  type GenericMutationCtx,
} from "convex/server";
import { Infer, v } from "convex/values";
import type { UserCallbacks } from "../../lib/types.ts";
import type { AuthCore } from "../../server/setup.ts";
import { sha256Hex } from "../../lib/crypto.ts";
import { CALLBACK_PATH } from "../../lib/oauth/constants.ts";
import {
  generateRandomToken,
  sha256Base64Url,
} from "../../lib/oauth/crypto.ts";
import {
  buildCompleteSignIn,
  parseUrl,
  validateAllowedRedirectOrigins,
} from "../../lib/oauth/redemption.ts";
import type { ComponentApi } from "../../components/workos/_generated/component.ts";
import {
  AUTHORIZATION_ENDPOINT,
  PROVIDER_NAME,
  type WorkosUserInfo,
} from "../../components/workos/constants.ts";
import { authorizationParams, takeRoute } from "./routing.ts";
import {
  vWorkosEvent,
  type WorkosEvent,
  type WorkosEvents,
} from "../../components/workos/schema.ts";

export type { WorkosUserInfo };
export type { WorkosHints, WorkosRoute } from "./routing.ts";
export {
  vConnection as vWorkosConnection,
  vDirectory as vWorkosDirectory,
  vDirectoryGroup as vWorkosDirectoryGroup,
  vDirectoryUser as vWorkosDirectoryUser,
  vOrganization as vWorkosOrganization,
  vOrganizationDomain as vWorkosOrganizationDomain,
  vWorkosEvent,
  type Connection as WorkosConnection,
  type Directory as WorkosDirectory,
  type DirectoryGroup as WorkosDirectoryGroup,
  type DirectoryUser as WorkosDirectoryUser,
  type Organization as WorkosOrganization,
  type OrganizationDomain as WorkosOrganizationDomain,
  type WorkosEvent,
  type WorkosEvents,
} from "../../components/workos/schema.ts";

/**
 * The account profile that the `workos` method produces, from WorkOS's SSO
 * profile. This is the exact shape the mapping emits, so the app can validate
 * against it precisely.
 */
export const vWorkosProfile = v.object({
  /** WorkOS's profile id, stable for a user of one connection. */
  id: v.string(),
  /** The user's id at the identity provider, as their directory user has it. */
  idpId: v.string(),
  organizationId: v.optional(v.string()),
  connectionId: v.string(),
  /** e.g. `"OktaSAML"`. */
  connectionType: v.string(),
  /**
   * Lowercased. The customer's identity provider asserts it; WorkOS does not
   * verify it. Trust it for account linking only when the email's domain is
   * one the organization verified (see `organizationDomains.get`).
   */
  email: v.string(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
});

export type WorkosProfile = Infer<typeof vWorkosProfile>;

/** Map WorkOS's SSO profile response to {@link WorkosProfile}. */
export function normalizeWorkosProfile(
  userInfoResponses: WorkosUserInfo | undefined,
): WorkosProfile {
  const profile = userInfoResponses?.profile;
  if (profile === undefined) {
    throw new Error("WorkOS returned no profile");
  }
  // The response is untrusted JSON, and these become the account's identity.
  if (typeof profile.id !== "string" || profile.id === "") {
    throw new Error("WorkOS profile has no id");
  }
  if (typeof profile.email !== "string") {
    throw new Error("WorkOS profile has no email");
  }
  return {
    id: profile.id,
    idpId: profile.idp_id,
    organizationId: profile.organization_id ?? undefined,
    connectionId: profile.connection_id,
    connectionType: profile.connection_type,
    email: profile.email.toLowerCase(),
    firstName: profile.first_name ?? undefined,
    lastName: profile.last_name ?? undefined,
  };
}

/** The name of this sign-in method. The app's user callbacks get it as `method.name`. */
const METHOD_NAME = "workos";

/** App-defined config for setting up the `workos` method. */
export type WorkosOptions = {
  /** The WorkOS component instance, i.e. `components.authWorkos`. */
  component: ComponentApi;
  /**
   * The path of the module that exports what `attachDirectoryCallbacks`
   * returns, e.g. `"auth"` for `convex/auth.ts`. The component calls its
   * `onWorkosEvent` for every change to its copy. Required with
   * `attachDirectoryCallbacks`. It is a path, not `internal.auth`, because a
   * reference to the module from inside it makes its types circular.
   */
  module?: string;
  /**
   * Origins `redirectTo` may point at, e.g. `["https://app.example.com"]`
   * for open-redirect prevention. Pass a function to read them when sign-in
   * starts, e.g. from the deployment's environment, instead of when the
   * module loads.
   */
  allowedRedirectOrigins: string[] | (() => string[]);
  /**
   * The `redirect_uri` WorkOS sends the user back to, read when sign-in
   * starts. It must reach the component's `<httpPrefix>/callback` route, e.g.
   * through a proxy on the app's own domain, and be a redirect URI of the
   * WorkOS environment. Defaults to `<CONVEX_SITE_URL><httpPrefix>/callback`.
   */
  callbackUrl?: () => string;
};

/**
 * Built-in sign-in method for enterprise SSO through WorkOS. Wire it up with
 * the WorkOS component:
 *
 * ```ts
 * import type { DataModel } from "./_generated/dataModel";
 *
 * const auth = setupConvexAuth({ component: components.auth });
 * export const { signOut, refreshSession, isAuthenticated } = auth;
 *
 * const workos = setupWorkos(auth, {
 *   component: components.authWorkos,
 *   module: "auth",
 *   allowedRedirectOrigins: ["https://app.example.com", "http://localhost:5173"],
 * });
 *
 * export const { startSignInWithWorkos, completeSignInWithWorkos } =
 *   workos.attachUserCallbacks({ createUser: internal.users.createUserWorkos });
 *
 * export const { syncWorkos, unregisterWorkos, onWorkosEvent } =
 *   workos.attachDirectoryCallbacks<DataModel>({
 *     "dsync.user.updated": async (ctx, user) => {
 *       // Map the directory user onto the app's user and roles.
 *     },
 *   });
 * ```
 *
 * Setup:
 *
 * 1. Install the component in convex.config.ts under
 *    `httpPrefix: "/workos"`, binding the WorkOS environment's `CLIENT_ID`
 *    and its API key as `CLIENT_SECRET`.
 * 2. Add `<site-url>/workos/callback`, or the `callbackUrl` you pass, as a
 *    redirect URI in the WorkOS dashboard.
 *
 * It uses WorkOS's SSO API, not AuthKit: WorkOS creates no users and no
 * sessions of its own, and the session is Convex Auth's.
 */
export function setupWorkos<UsersTable extends string>(
  core: AuthCore<UsersTable>,
  options: WorkosOptions,
) {
  const origins = options.allowedRedirectOrigins;
  let allowedOrigins: () => string[];
  if (typeof origins === "function") {
    allowedOrigins = () => validateAllowedRedirectOrigins(origins());
  } else {
    const validated = validateAllowedRedirectOrigins(origins);
    allowedOrigins = () => validated;
  }
  const callbackUrl = options.callbackUrl;

  return {
    /**
     * Supply the app's user callbacks (see {@link UserCallbacks} for how their
     * args must be declared) and get the functions of this method to export.
     */
    attachUserCallbacks(
      callbacks: UserCallbacks<typeof METHOD_NAME, WorkosProfile, UsersTable>,
    ) {
      const { authMutation } = core.bindMethod({
        name: METHOD_NAME,
        createUser: callbacks.createUser,
        onSignIn: callbacks.onSignIn,
      });

      // The route rides on `redirectTo` (see `routing.ts`), so this takes
      // the same arguments as every other method's `startSignIn`.
      const startSignIn = mutationGeneric({
        args: { redirectTo: v.string() },
        returns: v.object({ redirect: v.string(), state: v.string() }),
        handler: async (ctx, args) => {
          const redirectTo = parseUrl(args.redirectTo);
          if (redirectTo === null) {
            throw new Error("redirectTo must be an absolute URL");
          }
          const routingParams = authorizationParams(takeRoute(redirectTo));
          if (!allowedOrigins().includes(redirectTo.origin)) {
            throw new Error(
              `redirectTo origin "${redirectTo.origin}" is not in allowedRedirectOrigins`,
            );
          }

          const state = generateRandomToken();
          const codeVerifier = generateRandomToken();
          const request = await ctx.runMutation(
            options.component.provider
              ._internal_dangerous_createAuthorizationRequest,
            {
              stateHash: await sha256Hex(state),
              redirectTo: redirectTo.toString(),
              codeVerifier,
              ...(callbackUrl === undefined
                ? {}
                : { callbackUrl: callbackUrl() }),
            },
          );
          if (
            callbackUrl === undefined &&
            new URL(request.callbackUrl).pathname === CALLBACK_PATH
          ) {
            throw new Error(
              `The WorkOS component is not served under an httpPrefix, so ` +
                `its callback URL would be ${request.callbackUrl}, which ` +
                `returns 404. In convex/convex.config.ts, install it with ` +
                `\`app.use(authWorkos, { httpPrefix: "/workos", ... })\`.`,
            );
          }

          const url = new URL(AUTHORIZATION_ENDPOINT);
          const params: Record<string, string> = {
            ...routingParams,
            response_type: "code",
            client_id: request.clientId,
            redirect_uri: request.callbackUrl,
            state,
            code_challenge: await sha256Base64Url(codeVerifier),
            code_challenge_method: "S256",
          };
          for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
          }
          return { redirect: url.toString(), state };
        },
      });

      const completeSignIn = buildCompleteSignIn<
        WorkosProfile,
        { userInfoResponses?: WorkosUserInfo }
      >({
        providerName: PROVIDER_NAME,
        authMutation,
        component: options.component,
        claimTicket: (ctx, args) =>
          ctx.runMutation(options.component.provider.claimTicket, args),
        getUserIdByAccount: (ctx, args) =>
          ctx.runQuery(options.component.provider.getUserIdByAccount, args),
        createAccount: (ctx, args) =>
          ctx.runMutation(
            options.component.provider._internal_dangerous_createAccount,
            args,
          ),
        profile: (payload) => normalizeWorkosProfile(payload.userInfoResponses),
      });

      return {
        startSignInWithWorkos: startSignIn,
        completeSignInWithWorkos: completeSignIn,
      };
    },

    /**
     * Supply the app's handlers for WorkOS's events, keyed by event name, and
     * get the functions to export from the module `module` names. The
     * component runs the handler for each change to its copy, in the
     * transaction that makes it, with the object as WorkOS holds it now: a
     * webhook delivery reads its object again, so deliveries can arrive in
     * any order, and `syncWorkos`'s listing makes the same changes and runs
     * the same handlers. A throw refuses the delivery, which WorkOS retries,
     * and stops a sync.
     *
     * Run `syncWorkos` on every deploy: it registers this deployment's
     * webhook endpoint at WorkOS once and keeps its signing secret, then lists
     * everything in the background and repairs what the webhook missed. Run
     * `unregisterWorkos` before the deployment is deleted.
     */
    attachDirectoryCallbacks<DataModel extends GenericDataModel>(
      callbacks: WorkosCallbacks<DataModel>,
    ) {
      if (options.module === undefined) {
        throw new Error(
          "Pass `module` to setupWorkos: the path of the module that exports onWorkosEvent",
        );
      }
      const onEvent = makeFunctionReference<
        "mutation",
        { event: WorkosEvent },
        null
      >(`${options.module}:onWorkosEvent`);
      return {
        syncWorkos: internalActionGeneric({
          args: {},
          returns: v.null(),
          handler: async (ctx) => {
            await ctx.runAction(options.component.webhook.register, {
              onEvent: await createFunctionHandle(onEvent),
            });
            await ctx.runMutation(options.component.reconcile.start, {});
            return null;
          },
        }),
        unregisterWorkos: internalActionGeneric({
          args: {},
          returns: v.object({ deleted: v.boolean() }),
          handler: async (ctx) =>
            await ctx.runAction(options.component.webhook.unregister, {}),
        }),
        onWorkosEvent: internalMutationGeneric({
          args: { event: vWorkosEvent },
          returns: v.null(),
          handler: async (ctx: GenericMutationCtx<DataModel>, { event }) => {
            await dispatch(ctx, callbacks, event);
            return null;
          },
        }),
      };
    },
  };
}

/**
 * The app's handlers, by WorkOS event name, each given the event's object.
 * An event without a handler is ignored.
 */
export type WorkosCallbacks<DataModel extends GenericDataModel> = {
  [Name in keyof WorkosEvents]?: (
    ctx: GenericMutationCtx<DataModel>,
    data: WorkosEvents[Name],
  ) => Promise<void>;
};

async function dispatch<
  DataModel extends GenericDataModel,
  Name extends keyof WorkosEvents,
>(
  ctx: GenericMutationCtx<DataModel>,
  callbacks: WorkosCallbacks<DataModel>,
  event: { event: Name; data: WorkosEvents[Name] },
) {
  const handler: WorkosCallbacks<DataModel>[Name] = callbacks[event.event];
  if (handler !== undefined) await handler(ctx, event.data);
}
