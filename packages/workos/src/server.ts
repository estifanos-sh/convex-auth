/**
 * The `workos` sign-in method, exported at `@estifanos-sh/convex-workos/server`:
 * enterprise SSO through WorkOS, on the OAuth kit of `@convex-dev/auth`, and
 * the validators of everything the WorkOS component keeps and returns.
 *
 * @module
 */
import { mutationGeneric, type RegisteredMutation } from "convex/server";
import { v } from "convex/values";
import type { AuthCore } from "@convex-dev/auth/server";
import { sha256Hex } from "@convex-dev/auth/lib/crypto";
import { CALLBACK_PATH } from "@convex-dev/auth/lib/oauth/constants";
import {
  generateRandomToken,
  sha256Base64Url,
} from "@convex-dev/auth/lib/oauth/crypto";
import {
  buildCompleteSignIn,
  type CompleteSignInResult,
  parseUrl,
  type TicketPayload,
  validateAllowedRedirectOrigins,
} from "@convex-dev/auth/lib/oauth/redemption";
import type { UserCallbacks } from "@convex-dev/auth/lib/types";
import type { ComponentApi } from "./component/_generated/component.ts";
import {
  AUTHORIZATION_ENDPOINT,
  PROVIDER_NAME,
} from "./component/constants.ts";
import { decode } from "./component/decode.ts";
import { type Profile, vProfile } from "./component/validators.ts";
import { authorizationParams, takeRoute } from "./routing.ts";

export type { WorkosHints, WorkosRoute } from "./routing.ts";
export { DecodeError } from "./component/decode.ts";
export {
  vConnection as vWorkosConnection,
  vDirectory as vWorkosDirectory,
  vDirectoryGroup as vWorkosDirectoryGroup,
  vDirectoryUser as vWorkosDirectoryUser,
  vIntent as vWorkosIntent,
  vOrganization as vWorkosOrganization,
  vOrganizationDomain as vWorkosOrganizationDomain,
  vProfile as vWorkosProfile,
  vWorkosEvent,
  type Connection as WorkosConnection,
  type Directory as WorkosDirectory,
  type DirectoryGroup as WorkosDirectoryGroup,
  type DirectoryUser as WorkosDirectoryUser,
  type Intent as WorkosIntent,
  type Organization as WorkosOrganization,
  type OrganizationDomain as WorkosOrganizationDomain,
  type Profile as WorkosProfile,
  type WorkosEvent,
  type WorkosEvents,
} from "./component/validators.ts";

/** The name of this sign-in method. The app's user callbacks get it as `method.name`. */
const METHOD_NAME = "workos";

/** App-defined config for setting up the `workos` method. */
export type WorkosOptions = {
  /** The WorkOS component instance, e.g. `components.authWorkos`. */
  component: ComponentApi;
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

/** The functions of the method, for the app to export. */
export type WorkosFunctions = {
  /** Start an SSO sign-in to the route `redirectTo` carries (see `addRoute`). */
  startSignInWithWorkos: RegisteredMutation<
    "public",
    { redirectTo: string },
    Promise<{ redirect: string; state: string }>
  >;
  /** Redeem the one-time code the callback redirected back with. */
  completeSignInWithWorkos: RegisteredMutation<
    "public",
    { code: string; state: string },
    Promise<CompleteSignInResult>
  >;
};

/** What the callback fetched with the access token. */
type WorkosPayload = TicketPayload<{ profile?: unknown }>;

/**
 * Built-in sign-in method for enterprise SSO through WorkOS. Wire it up with
 * the WorkOS component:
 *
 * ```ts
 * const auth = setupConvexAuth({ component: components.auth });
 * export const { signOut, refreshSession, isAuthenticated } = auth;
 *
 * export const { startSignInWithWorkos, completeSignInWithWorkos } =
 *   setupWorkos(auth, {
 *     component: components.authWorkos,
 *     allowedRedirectOrigins: ["https://app.example.com", "http://localhost:5173"],
 *   }).attachUserCallbacks({ createUser: internal.users.createUserWorkos });
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
  const { component, callbackUrl } = options;

  return {
    /**
     * Supply the app's user callbacks (see `UserCallbacks` for how their
     * args must be declared) and get the functions of this method to export.
     */
    attachUserCallbacks(
      callbacks: UserCallbacks<typeof METHOD_NAME, Profile, UsersTable>,
    ): WorkosFunctions {
      const { authMutation } = core.bindMethod({
        name: METHOD_NAME,
        createUser: callbacks.createUser,
        onSignIn: callbacks.onSignIn,
      });

      // The kit's `buildStartSignIn` takes no authorize parameters, and
      // WorkOS's route is one, so this start is WorkOS's own. The route rides
      // on `redirectTo` (see `routing.ts`), so it takes the same arguments as
      // every other method's start.
      const startSignInWithWorkos = mutationGeneric({
        args: { redirectTo: v.string() },
        returns: v.object({ redirect: v.string(), state: v.string() }),
        handler: async (ctx, args) => {
          const redirectTo = parseUrl(args.redirectTo);
          if (redirectTo === null) {
            throw new Error("redirectTo must be an absolute URL");
          }
          const route = authorizationParams(takeRoute(redirectTo));
          if (!allowedOrigins().includes(redirectTo.origin)) {
            throw new Error(
              `redirectTo origin "${redirectTo.origin}" is not in allowedRedirectOrigins`,
            );
          }
          const state = generateRandomToken();
          const codeVerifier = generateRandomToken();
          const request = await ctx.runMutation(
            component.provider._internal_dangerous_createAuthorizationRequest,
            {
              stateHash: await sha256Hex(state),
              redirectTo: redirectTo.toString(),
              codeVerifier,
              callbackUrl: callbackUrl?.(),
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
                `\`app.use(workos, { httpPrefix: "/workos", ... })\`.`,
            );
          }
          const url = new URL(AUTHORIZATION_ENDPOINT);
          for (const [key, value] of Object.entries({
            ...route,
            response_type: "code",
            client_id: request.clientId,
            redirect_uri: request.callbackUrl,
            state,
            code_challenge: await sha256Base64Url(codeVerifier),
            code_challenge_method: "S256",
          })) {
            url.searchParams.set(key, value);
          }
          return { redirect: url.toString(), state };
        },
      });

      const completeSignInWithWorkos = buildCompleteSignIn<
        Profile,
        WorkosPayload
      >({
        providerName: PROVIDER_NAME,
        authMutation,
        component,
        claimTicket: (ctx, args) =>
          ctx.runMutation(component.provider.claimTicket, args),
        getUserIdByAccount: (ctx, args) =>
          ctx.runQuery(component.provider.getUserIdByAccount, args),
        createAccount: (ctx, args) =>
          ctx.runMutation(
            component.provider._internal_dangerous_createAccount,
            args,
          ),
        profile: (payload) =>
          decode(vProfile, payload.userInfoResponses?.profile),
      });

      return { startSignInWithWorkos, completeSignInWithWorkos };
    },
  };
}
