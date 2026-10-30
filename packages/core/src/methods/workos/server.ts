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
  type FunctionReference,
} from "convex/server";
import { Infer, v } from "convex/values";
import type { UserCallbacks } from "../../lib/types.ts";
import type { AuthCore } from "../../server/setup.ts";
import { buildStartSignIn } from "../../lib/oauth/authorize.ts";
import {
  buildCompleteSignIn,
  validateAllowedRedirectOrigins,
} from "../../lib/oauth/redemption.ts";
import type { ComponentApi } from "../../components/workos/_generated/component.ts";
import {
  AUTHORIZATION_ENDPOINT,
  PROVIDER_NAME,
  SCOPES,
  type WorkosUserInfo,
} from "../../components/workos/constants.ts";
import type { WorkosDirectoryChange } from "../../components/workos/schema.ts";

export type { WorkosUserInfo };
export {
  vWorkosConnection,
  vWorkosDirectory,
  vWorkosDirectoryChange,
  vWorkosDirectoryGroup,
  vWorkosDirectoryMember,
  vWorkosDirectoryUser,
  vWorkosDomain,
  vWorkosOrganization,
  type WorkosConnection,
  type WorkosDirectory,
  type WorkosDirectoryChange,
  type WorkosDirectoryGroup,
  type WorkosDirectoryMember,
  type WorkosDirectoryUser,
  type WorkosDomain,
  type WorkosOrganization,
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
   * one the organization verified (see `directory.route`).
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

/**
 * Where `startSignInWithWorkos` sends the user. Exactly one of
 * `organizationId` and `connectionId` is required: WorkOS picks the
 * organization's active connection, or uses the one given.
 */
export const vWorkosRouting = {
  /** A WorkOS organization id (`org_...`), e.g. from `directory.route`. */
  organizationId: v.optional(v.string()),
  /** A WorkOS connection id (`conn_...`). */
  connectionId: v.optional(v.string()),
  /** Pre-fills the email at the identity provider, where it supports it. */
  loginHint: v.optional(v.string()),
  /** Pre-fills the domain, for Microsoft OAuth and Google SAML connections. */
  domainHint: v.optional(v.string()),
};

export type WorkosRouting = {
  organizationId?: string;
  connectionId?: string;
  loginHint?: string;
  domainHint?: string;
};

const MAX_ROUTING_LENGTH = 256;

/** WorkOS's authorize parameters for a routing, refusing a malformed one. */
function authorizationParams(routing: WorkosRouting): Record<string, string> {
  const { organizationId, connectionId, loginHint, domainHint } = routing;
  if ((organizationId === undefined) === (connectionId === undefined)) {
    throw new Error(
      "startSignInWithWorkos takes exactly one of organizationId and connectionId",
    );
  }
  for (const value of [organizationId, connectionId, loginHint, domainHint]) {
    if (value !== undefined && value.length > MAX_ROUTING_LENGTH) {
      throw new Error("A WorkOS routing argument is too long");
    }
  }
  if (organizationId !== undefined && !organizationId.startsWith("org_")) {
    throw new Error("organizationId must be a WorkOS organization id");
  }
  if (connectionId !== undefined && !connectionId.startsWith("conn_")) {
    throw new Error("connectionId must be a WorkOS connection id");
  }
  const params: Record<string, string> = {};
  if (organizationId !== undefined) params.organization = organizationId;
  if (connectionId !== undefined) params.connection = connectionId;
  if (loginHint !== undefined) params.login_hint = loginHint;
  if (domainHint !== undefined) params.domain_hint = domainHint;
  return params;
}

/** App-defined config for setting up the `workos` method. */
export type WorkosMethodOptions = {
  /** The WorkOS component instance, i.e. `components.authWorkos`. */
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

/**
 * Built-in sign-in method for enterprise SSO through WorkOS. Wire it up with
 * the WorkOS component:
 *
 * ```ts
 * const auth = setupConvexAuth({ component: components.auth });
 * export const { signOut, refreshSession, isAuthenticated } = auth;
 *
 * export const { startSignInWithWorkos, completeSignInWithWorkos } = setupWorkos(auth, {
 *   component: components.authWorkos,
 *   allowedRedirectOrigins: ["https://app.example.com", "http://localhost:5173"],
 * }).attachUserCallbacks({ createUser: internal.users.createUserWorkos });
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
  options: WorkosMethodOptions,
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
      callbacks: UserCallbacks<"workos", WorkosProfile, UsersTable>,
    ) {
      const { authMutation } = core.bindProvider({
        name: PROVIDER_NAME,
        createUser: callbacks.createUser,
        onSignIn: callbacks.onSignIn,
      });

      const startSignIn = buildStartSignIn({
        allowedOrigins,
        authorizationEndpoint: AUTHORIZATION_ENDPOINT,
        scopes: SCOPES,
        startArgs: vWorkosRouting,
        authorizationParams,
        createAuthorizationRequest:
          callbackUrl === undefined
            ? options.component.provider.createAuthorizationRequest
            : (ctx, args) =>
                ctx.runMutation(
                  options.component.provider.createAuthorizationRequest,
                  { ...args, callbackUrl: callbackUrl() },
                ),
      });

      const completeSignIn = buildCompleteSignIn<
        WorkosProfile,
        { userInfoResponses?: WorkosUserInfo }
      >({
        providerName: PROVIDER_NAME,
        authMutation,
        claimTicket: (ctx, args) =>
          ctx.runMutation(options.component.provider.claimTicket, args),
        profile: (payload) => normalizeWorkosProfile(payload.userInfoResponses),
      });

      return {
        startSignInWithWorkos: startSignIn,
        completeSignInWithWorkos: completeSignIn,
      };
    },
  };
}

/** The app's handler for directory changes. */
export type WorkosChangeHandler = FunctionReference<
  "mutation",
  "internal",
  { change: WorkosDirectoryChange },
  null
>;

/**
 * Keep the WorkOS component's copy of the directories current, and run
 * `onChange` for each change, in the transaction that makes it. The handler
 * maps directory users and groups onto the app's own users and roles; a
 * `user` change with `deprovisioned: true` is the signal to revoke the app
 * user's sessions.
 *
 * ```ts
 * export const {
 *   registerWorkosWebhook,
 *   reconcileWorkosDirectory,
 *   unregisterWorkosWebhook,
 * } = setupWorkosDirectory({
 *   component: components.authWorkos,
 *   onChange: internal.workos.onDirectoryChange,
 * });
 * ```
 *
 * On every deploy, run `registerWorkosWebhook`, which creates this
 * deployment's webhook endpoint at WorkOS once and keeps its signing secret
 * and the handler, then `reconcileWorkosDirectory`, which lists everything
 * in the background and repairs what the webhook missed. Run
 * `unregisterWorkosWebhook` before you delete the deployment.
 *
 * WorkOS delivers changes in no guaranteed order, so each delivery reads its
 * object again and the copy holds what WorkOS holds now. The handler must not throw for a change it doesn't
 * care about: a throw refuses the delivery, which WorkOS retries, and stops
 * a reconcile.
 */
export function setupWorkosDirectory(options: {
  /** The WorkOS component instance, i.e. `components.authWorkos`. */
  component: ComponentApi;
  /** An internal mutation taking `{ change: vWorkosDirectoryChange }`. */
  onChange: WorkosChangeHandler;
}) {
  return {
    registerWorkosWebhook: internalActionGeneric({
      args: {},
      returns: v.object({ endpointId: v.string(), created: v.boolean() }),
      handler: async (ctx) =>
        await ctx.runAction(options.component.webhook.register, {
          onChange: await createFunctionHandle(options.onChange),
        }),
    }),
    reconcileWorkosDirectory: internalMutationGeneric({
      args: {},
      returns: v.null(),
      handler: async (ctx) => {
        await ctx.runMutation(options.component.reconcile.start, {});
        return null;
      },
    }),
    unregisterWorkosWebhook: internalActionGeneric({
      args: {},
      returns: v.object({ deleted: v.boolean() }),
      handler: async (ctx) =>
        await ctx.runAction(options.component.webhook.unregister, {}),
    }),
  };
}
