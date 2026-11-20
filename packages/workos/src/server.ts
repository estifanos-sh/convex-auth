/**
 * The `workos` sign-in method, exported at `@estifanos-sh/convex-workos/server`:
 * enterprise SSO through WorkOS, on the OAuth kit of `@convex-dev/auth`, and
 * the validators of everything the WorkOS component keeps and returns.
 *
 * @module
 */
import {
  type FunctionReference_future,
  type GenericDataModel,
  type GenericMutationCtx,
  mutationGeneric,
  type RegisteredMutation,
} from "convex/server";
import { type ObjectType, type PropertyValidators, v } from "convex/values";
import type { AuthCore } from "@convex-dev/auth/server";
import { sha256Hex } from "@convex-dev/auth/lib/crypto";
import { CALLBACK_PATH } from "@convex-dev/auth/lib/oauth/constants";
import {
  decryptTicketPayload,
  encryptTicketPayload,
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
import {
  type BoundAuthHelpers,
  type ConvexAuthCtx,
  type UserCallbacks,
  vSignInComplete,
  vSignInError,
} from "@convex-dev/auth/lib/types";
import type { ComponentApi } from "./component/_generated/component.ts";
import {
  AUTHORIZATION_ENDPOINT,
  DEFERRED_STATE_HASH,
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
  vLanded as vWorkosLanded,
  vProfile as vWorkosProfile,
  vWorkosEvent,
  type Connection as WorkosConnection,
  type Directory as WorkosDirectory,
  type DirectoryGroup as WorkosDirectoryGroup,
  type DirectoryUser as WorkosDirectoryUser,
  type Intent as WorkosIntent,
  type Organization as WorkosOrganization,
  type OrganizationDomain as WorkosOrganizationDomain,
  type Landed as WorkosLanded,
  type Profile as WorkosProfile,
  type WorkosEvent,
  type WorkosEvents,
} from "./component/validators.ts";

/** The name of this sign-in method. The app's user callbacks get it as `method.name`. */
const METHOD_NAME = "workos";

/** The args of the method's own start; the kit's redemption names its own. */
const START_ARGS = { redirectTo: v.string() };

/** The args of the completion of a host that provisions users. */
const COMPLETE_ARGS = { code: v.string(), state: v.string() };

/** The args of the finish of a deferred sign-in. */
const FINISH_ARGS = { ticket: v.string() };

/** The args of the method's own functions, which host args may not reuse. */
const OWN_ARGS = [START_ARGS, COMPLETE_ARGS, FINISH_ARGS].flatMap((args) =>
  Object.keys(args),
);

/**
 * Validators of the args a host app passes to every call of the method's
 * functions, besides their own, e.g. `{ siteId: v.id("sites") }`. They may
 * not reuse the name of an arg of the method's own.
 */
export type HostArgs = PropertyValidators;

/** No host args. */
export type NoHostArgs = Record<never, never>;

/**
 * The account profile the app's `createUser` and `onSignIn` get: WorkOS's
 * SSO profile, and in `host` the host args of the call that signed the user
 * in: the completion, or the finish of a deferred sign-in.
 */
export type WorkosAccount<Host extends HostArgs = NoHostArgs> = Profile & {
  host: ObjectType<Host>;
};

/**
 * The validator of {@link WorkosAccount}, for the `method.profile` arg of the
 * app's `createUser` and `onSignIn`. Pass the same host args as to
 * `setupWorkos`, or `{}` for none.
 */
export function vWorkosAccount<Host extends HostArgs>(host: Host) {
  return v.object({ ...vProfile.fields, host: v.object(host) });
}

/**
 * What the app's `provision` answers for an account with no user yet:
 * `ready` to create the user now with `createUser`, or `defer` while the app
 * provisions it asynchronously.
 */
export type WorkosProvision = { ready: true } | { defer: true };

/**
 * The validator of {@link WorkosProvision}, for the `returns` of the app's
 * `provision`:
 *
 * ```ts
 * export const provisionWorkos = internalMutation({
 *   args: vWorkosProvisionArgs({}),
 *   returns: vWorkosProvision,
 *   handler: async (ctx, { profile }) => {
 *     const user = await ctx.db
 *       .query("users")
 *       .withIndex("workosId", (q) => q.eq("workosId", profile.id))
 *       .unique();
 *     if (user !== null) return { ready: true as const };
 *     await ctx.scheduler.runAfter(0, internal.users.importWorkos, {
 *       workosId: profile.id,
 *     });
 *     return { defer: true as const };
 *   },
 * });
 * ```
 */
export const vWorkosProvision = v.union(
  v.object({ ready: v.literal(true) }),
  v.object({ defer: v.literal(true) }),
);

/**
 * The args validators of the app's `provision`: WorkOS's SSO profile and the
 * host args of the completion or the finish that asks. Pass the same host args
 * as to `setupWorkos`, or `{}` for none.
 */
export function vWorkosProvisionArgs<Host extends HostArgs>(host: Host) {
  return { profile: vProfile, host: v.object(host) };
}

/**
 * The app's `provision`, an internal mutation. It runs, in the transaction
 * of the call, before `createUser` for an account with no user yet, on the
 * completion and on each finish of a sign-in it deferred. Since it runs
 * again on each finish, the work it files must be idempotent.
 */
export type ProvisionFn<Host extends HostArgs = NoHostArgs> =
  FunctionReference_future<
    "mutation",
    "internal",
    { profile: Profile; host: ObjectType<Host> },
    WorkosProvision
  >;

/**
 * The user callbacks of an app that provisions its users: the core's
 * `createUser` and `onSignIn`, and `provision`.
 */
export type ProvisionedUserCallbacks<
  UsersTable extends string = string,
  Host extends HostArgs = NoHostArgs,
> = UserCallbacks<typeof METHOD_NAME, WorkosAccount<Host>, UsersTable> & {
  provision: ProvisionFn<Host>;
};

/**
 * A sign-in the app deferred: the identity is verified, the app is still
 * provisioning its user, and `ticket` finishes it. Only the WorkOS client
 * handles it: the SSR proxy forwards only the shared sign-in envelope, so its
 * `signIn` allowlist refuses a function that can return this.
 */
export type WorkosDeferred = { status: "deferred"; ticket: string };

/**
 * What the completion and the finish of a host that provisions users
 * return: the session, the ticket of a sign-in the app deferred, or
 * `INVALID_CODE` for a code or ticket that is unknown, spent or expired.
 */
export type WorkosSignInResult = CompleteSignInResult | WorkosDeferred;

const vWorkosSignInResult = v.union(
  vSignInComplete,
  vSignInError(v.object({ error: v.literal("INVALID_CODE") })),
  v.object({ status: v.literal("deferred"), ticket: v.string() }),
);

const INVALID_CODE = {
  status: "error",
  userError: { error: "INVALID_CODE" },
} as const;

/** What the ticket of a code redemption holds: WorkOS's profile response. */
const vTicketProfile = v.object({
  userInfoResponses: v.object({ profile: vProfile }),
});

/** App-defined config for setting up the `workos` method. */
export type WorkosOptions<Host extends HostArgs = NoHostArgs> = {
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
  /**
   * Args the host app passes to every call of the method's functions, such
   * as the site a sign-in is for. Both functions validate them, and the
   * call that completes the sign-in hands them to `createUser` and
   * `onSignIn` as `method.profile.host`.
   */
  args?: Host;
};

/** The functions of the method, for the app to export. */
export type WorkosFunctions<Host extends HostArgs = NoHostArgs> = {
  /** Start an SSO sign-in to the route `redirectTo` carries (see `addRoute`). */
  startSignInWithWorkos: RegisteredMutation<
    "public",
    { redirectTo: string } & ObjectType<Host>,
    Promise<{ redirect: string; state: string }>
  >;
  /** Redeem the one-time code the callback redirected back with. */
  completeSignInWithWorkos: RegisteredMutation<
    "public",
    { code: string; state: string } & ObjectType<Host>,
    Promise<CompleteSignInResult>
  >;
};

/**
 * The functions of the method for a host that provisions users, for the app
 * to export. Its client is `workos()` from the package's `react` entry.
 */
export type ProvisionedWorkosFunctions<Host extends HostArgs = NoHostArgs> = {
  /** Start an SSO sign-in to the route `redirectTo` carries (see `addRoute`). */
  startSignInWithWorkos: WorkosFunctions<Host>["startSignInWithWorkos"];
  /**
   * Redeem the one-time code the callback redirected back with. For an
   * account with no user yet, it asks `provision` first, and when that
   * defers, it mints no session and returns the ticket of the deferred
   * sign-in.
   */
  completeSignInWithWorkos: RegisteredMutation<
    "public",
    { code: string; state: string } & ObjectType<Host>,
    Promise<WorkosSignInResult>
  >;
  /**
   * Redeem the ticket of a deferred sign-in. It asks `provision` again with
   * the profile the deferring completion kept and the host args of this
   * call, and while that still defers, returns the same ticket.
   */
  finishSignInWithWorkos: RegisteredMutation<
    "public",
    { ticket: string } & ObjectType<Host>,
    Promise<WorkosSignInResult>
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
 *
 * An app that provisions its users asynchronously, through a workflow or a
 * queue, attaches its callbacks with `attachProvisionedUserCallbacks`, with a
 * `provision` (see {@link vWorkosProvision}), and its client registers
 * `workos()` in place of `oauth()`.
 */
export function setupWorkos<
  UsersTable extends string,
  Host extends HostArgs = NoHostArgs,
>(core: AuthCore<UsersTable>, options: WorkosOptions<Host>) {
  const origins = options.allowedRedirectOrigins;
  let allowedOrigins: () => string[];
  if (typeof origins === "function") {
    allowedOrigins = () => validateAllowedRedirectOrigins(origins());
  } else {
    const validated = validateAllowedRedirectOrigins(origins);
    allowedOrigins = () => validated;
  }
  const { component, callbackUrl } = options;
  const host = hostArgs(options.args);

  /** Bind the method to the core with the app's callbacks, and build its start. */
  function bind(
    callbacks: UserCallbacks<
      typeof METHOD_NAME,
      WorkosAccount<Host>,
      UsersTable
    >,
  ) {
    const { authMutation } = core.bindMethod({
      name: METHOD_NAME,
      createUser: callbacks.createUser,
      onSignIn: callbacks.onSignIn,
    });

    // The kit's `buildStartSignIn` takes no authorize parameters, and
    // WorkOS's route is one, so this start is WorkOS's own. The route rides
    // on `redirectTo` (see `routing.ts`), so it takes the same arguments as
    // every other method's start, and the host args.
    const startSignInWithWorkos = mutationGeneric({
      args: { ...host, ...START_ARGS },
      returns: v.object({ redirect: v.string(), state: v.string() }),
      handler: async (ctx, args) => {
        const redirectTo = parseUrl(pick(START_ARGS, args).redirectTo);
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
    return { authMutation, startSignInWithWorkos };
  }

  return {
    /**
     * Supply the app's user callbacks (see `UserCallbacks` for how their
     * args must be declared) and get the functions of this method to export.
     */
    attachUserCallbacks(
      callbacks: UserCallbacks<
        typeof METHOD_NAME,
        WorkosAccount<Host>,
        UsersTable
      >,
    ): WorkosFunctions<Host> {
      const { authMutation, startSignInWithWorkos } = bind(callbacks);

      // The kit's redemption maps the ticket to WorkOS's profile and takes
      // only its own args. This builder adds the host args to the mutation
      // it builds, and the host values to the profile it hands the core. The
      // core does not export the builder's type, so `bindMethod` names it.
      type KitBuilder = ReturnType<
        typeof core.bindMethod<typeof METHOD_NAME, Profile>
      >["authMutation"];
      const redeem: KitBuilder = (fn) =>
        authMutation({
          args: { ...host, ...fn.args },
          returns: fn.returns,
          handler: (ctx, args) =>
            fn.handler(
              { ...ctx, convexAuth: hosted(ctx.convexAuth, pick(host, args)) },
              pick(fn.args, args),
            ),
        });

      const completeSignInWithWorkos = buildCompleteSignIn<
        Profile,
        WorkosPayload
      >({
        providerName: PROVIDER_NAME,
        authMutation: redeem,
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

    /**
     * Supply the app's user callbacks with `provision`, for an app that
     * provisions its users asynchronously, and get the functions of this
     * method to export, `finishSignInWithWorkos` among them. A sign-in of an
     * account with no user yet waits while `provision` defers.
     */
    attachProvisionedUserCallbacks(
      callbacks: ProvisionedUserCallbacks<UsersTable, Host>,
    ): ProvisionedWorkosFunctions<Host> {
      const { authMutation, startSignInWithWorkos } = bind(callbacks);
      const { provision } = callbacks;

      type Ctx = GenericMutationCtx<GenericDataModel> &
        ConvexAuthCtx<WorkosAccount<Host>>;
      type Kept = { profile: Profile; host: ObjectType<Host> };

      /**
       * Sign the account's user in, or, for an account with no user yet, ask
       * `provision`: on `ready`, create the user through the core's sign-up,
       * and on `defer`, return the ticket `deferral` gives.
       */
      const settle = async (
        ctx: Ctx,
        kept: Kept,
        deferral: () => Promise<string>,
      ): Promise<WorkosSignInResult> => {
        const account: WorkosAccount<Host> = {
          ...kept.profile,
          host: kept.host,
        };
        const userId = await ctx.runQuery(
          component.provider.getUserIdByAccount,
          {
            providerAccountId: account.id,
          },
        );
        if (userId !== null) {
          const tokens = await ctx.convexAuth.completeSignIn({
            userId,
            profile: account,
            authenticatedBy: component,
          });
          return { status: "complete", tokens };
        }
        if ("defer" in (await ctx.runMutation(provision, kept))) {
          return { status: "deferred", ticket: await deferral() };
        }
        const tokens = await ctx.convexAuth.completeSignUp({
          profile: account,
          authenticatedBy: component,
        });
        await ctx.runMutation(
          component.provider._internal_dangerous_createAccount,
          { providerAccountId: account.id, userId: tokens.userId },
        );
        return { status: "complete", tokens };
      };

      const completeSignInWithWorkos = authMutation({
        args: { ...host, ...COMPLETE_ARGS },
        returns: vWorkosSignInResult,
        handler: async (ctx, args): Promise<WorkosSignInResult> => {
          const { code, state } = pick(COMPLETE_ARGS, args);
          const claimed = await ctx.runMutation(
            component.provider.claimTicket,
            {
              ticketCodeHash: await sha256Hex(code),
              stateHash: await sha256Hex(state),
            },
          );
          if (claimed === null) {
            return INVALID_CODE;
          }
          const payload = await decryptTicketPayload(
            code,
            claimed.encryptedPayload,
          );
          const kept: Kept = {
            profile: decode(vTicketProfile, JSON.parse(payload))
              .userInfoResponses.profile,
            host: pick(host, args),
          };
          return await settle(ctx, kept, async () => {
            const ticket = generateRandomToken();
            await ctx.runMutation(
              component.provider._internal_dangerous_deferTicket,
              {
                ticketCodeHash: await sha256Hex(ticket),
                encryptedPayload: await encryptTicketPayload(
                  ticket,
                  JSON.stringify(kept.profile),
                ),
              },
            );
            return ticket;
          });
        },
      });

      const finishSignInWithWorkos = authMutation({
        args: { ...host, ...FINISH_ARGS },
        returns: vWorkosSignInResult,
        handler: async (ctx, args): Promise<WorkosSignInResult> => {
          const { ticket } = pick(FINISH_ARGS, args);
          const ticketCodeHash = await sha256Hex(ticket);
          const deferred = await ctx.runQuery(
            component.provider.deferredTicket,
            {
              ticketCodeHash,
            },
          );
          if (deferred === null) {
            return INVALID_CODE;
          }
          const payload = await decryptTicketPayload(
            ticket,
            deferred.encryptedPayload,
          );
          const kept: Kept = {
            profile: decode(vProfile, JSON.parse(payload)),
            host: pick(host, args),
          };
          const result = await settle(ctx, kept, async () => ticket);
          if (result.status === "complete") {
            // The read above saw the ticket in this transaction, so the claim
            // finds it and spends it.
            await ctx.runMutation(component.provider.claimTicket, {
              ticketCodeHash,
              stateHash: DEFERRED_STATE_HASH,
            });
          }
          return result;
        },
      });

      return {
        startSignInWithWorkos,
        completeSignInWithWorkos,
        finishSignInWithWorkos,
      };
    },
  };
}

function hostArgs<Host extends HostArgs>(args: Host | undefined): Host {
  const host = args ?? ({} as Host);
  for (const name of OWN_ARGS) {
    if (name in host) {
      throw new Error(`The host arg "${name}" is an arg of the method's own`);
    }
  }
  return host;
}

/** The args `validators` names, among a call's validated args. */
function pick<Validators extends PropertyValidators>(
  validators: Validators,
  args: Record<string, unknown>,
): ObjectType<Validators> {
  const values: Record<string, unknown> = {};
  for (const name of Object.keys(validators)) {
    if (args[name] !== undefined) values[name] = args[name];
  }
  // Convex validated `args` against these validators before the handler ran.
  return values as ObjectType<Validators>;
}

/** The core's helpers over the account: WorkOS's profile and the host values. */
function hosted<Host extends HostArgs>(
  helpers: BoundAuthHelpers<WorkosAccount<Host>>,
  values: ObjectType<Host>,
): BoundAuthHelpers<Profile> {
  const account = (profile: Profile): WorkosAccount<Host> => ({
    ...profile,
    host: values,
  });
  return {
    ...helpers,
    completeSignUp: async (args) =>
      await helpers.completeSignUp({ ...args, profile: account(args.profile) }),
    completeSignIn: async (args) =>
      await helpers.completeSignIn({ ...args, profile: account(args.profile) }),
    signUpWithoutSession: async (args) =>
      await helpers.signUpWithoutSession({
        ...args,
        profile: account(args.profile),
      }),
  };
}
