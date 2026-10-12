/**
 * The WorkOS provider, exported at `@convex-dev/auth/methods/workos/server`.
 *
 * @module
 */
import {
  createFunctionHandle,
  type DefaultFunctionArgs,
  type FunctionReference,
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
  type PaginationOptions,
} from "convex/server";
import { Infer, ObjectType, v } from "convex/values";
import type { UserCallbacks } from "../../lib/types.ts";
import type { AuthCore } from "../../server/setup.ts";
import { buildStartSignIn } from "../../lib/oauth/authorize.ts";
import {
  buildCompleteSignIn,
  validateAllowedRedirectOrigins,
} from "../../lib/oauth/redemption.ts";
import type { ComponentApi } from "../../components/workos/_generated/component.ts";
import {
  AUTHKIT_PROVIDER,
  AUTHORIZATION_ENDPOINT,
  PROVIDER_NAME,
  SCOPES,
  type WorkosAuthentication,
} from "../../components/workos/constants.ts";

import type {
  ConnectionChange,
  DirectoryChange,
  DirectoryGroupChange,
  DirectoryMemberChange,
  DirectoryUserChange,
  MembershipChange,
  OrganizationChange,
  UserChange,
} from "../../components/workos/changes.ts";

export type { WorkosAuthentication };
export {
  vChangeKind as vWorkosChangeKind,
  vConnectionChange as vWorkosConnectionChange,
  vDirectoryChange as vWorkosDirectoryChange,
  vDirectoryGroupChange as vWorkosDirectoryGroupChange,
  vDirectoryMemberChange as vWorkosDirectoryMemberChange,
  vDirectoryUserChange as vWorkosDirectoryUserChange,
  vMembershipChange as vWorkosMembershipChange,
  vOrganizationChange as vWorkosOrganizationChange,
  vUserChange as vWorkosUserChange,
} from "../../components/workos/changes.ts";
export type {
  ChangeKind as WorkosChangeKind,
  ConnectionChange as WorkosConnectionChange,
  DirectoryChange as WorkosDirectoryChange,
  DirectoryGroupChange as WorkosDirectoryGroupChange,
  DirectoryMemberChange as WorkosDirectoryMemberChange,
  DirectoryUserChange as WorkosDirectoryUserChange,
  MembershipChange as WorkosMembershipChange,
  OrganizationChange as WorkosOrganizationChange,
  UserChange as WorkosUserChange,
} from "../../components/workos/changes.ts";

/**
 * The account profile the WorkOS provider produces. WorkOS returns the user
 * alongside its tokens, so identity comes from the token response. This is
 * the exact shape the mapping emits, so the app can validate against it
 * precisely.
 */
export const vWorkosProfile = v.object({
  /** The WorkOS user id (`user_...`), the stable provider account id. */
  id: v.string(),
  email: v.string(),
  /**
   * True when WorkOS attested the email as verified. False means it is
   * unverified, so don't trust it for account linking.
   */
  emailVerified: v.boolean(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  picture: v.optional(v.string()),
  /**
   * The organization the user signed in to (`org_...`), when the sign-in was
   * scoped to one, such as through its SSO connection.
   */
  organizationId: v.optional(v.string()),
  /** How the user authenticated, e.g. `"SSO"` or `"GoogleOAuth"`. */
  authenticationMethod: v.optional(v.string()),
});

export type WorkosProfile = Infer<typeof vWorkosProfile>;

/**
 * Map WorkOS's token response to {@link WorkosProfile}. An impersonated
 * sign-in never gets here: the component's exchange refuses it.
 */
export function normalizeWorkosProfile(
  tokenResponse: WorkosAuthentication | undefined,
): WorkosProfile {
  if (tokenResponse === undefined) {
    throw new Error("WorkOS returned no user to build a profile from");
  }
  const user = tokenResponse.user;
  // The response is untrusted JSON. A missing id would sign everyone without
  // one into the same account.
  if (typeof user.id !== "string" || user.id === "") {
    throw new Error("WorkOS user is missing an id");
  }
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.email_verified === true,
    firstName: user.first_name ?? undefined,
    lastName: user.last_name ?? undefined,
    picture: user.profile_picture_url ?? undefined,
    organizationId: tokenResponse.organization_id ?? undefined,
    authenticationMethod: tokenResponse.authentication_method,
  };
}

/**
 * Where a WorkOS sign-in goes, the arguments `startSignInWithWorkos` takes
 * beyond `redirectTo`:
 *
 * - `organizationId` (`org_...`): straight to that organization's SSO
 *   connection, skipping AuthKit's own sign-in page.
 * - `connectionId` (`conn_...`): straight to that SSO connection.
 * - `loginHint`: pre-fills the email or username at the identity provider.
 * - `domainHint`: pre-fills the domain for Microsoft OAuth and Google SAML.
 * - `screenHint`: `"sign-up"` or `"sign-in"`, the AuthKit screen to open.
 *   AuthKit only, so it can't be combined with an organization or connection.
 *
 * Without an organization or connection the sign-in goes to AuthKit.
 */
export const vWorkosRouting = {
  organizationId: v.optional(v.string()),
  connectionId: v.optional(v.string()),
  loginHint: v.optional(v.string()),
  domainHint: v.optional(v.string()),
  screenHint: v.optional(v.union(v.literal("sign-up"), v.literal("sign-in"))),
};

export type WorkosRouting = ObjectType<typeof vWorkosRouting>;

// WorkOS ids are a prefix and a 26-character ULID. Anything else is refused
// rather than sent on, so a caller can't smuggle other parameters in.
const ORGANIZATION_ID = /^org_[0-9A-Z]{26}$/;
const CONNECTION_ID = /^conn_[0-9A-Z]{26}$/;
const DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
// An email or a username: printable, no whitespace, at most an email's length.
const LOGIN_HINT = /^[^\s\p{Cc}]{1,320}$/u;

/**
 * The WorkOS authorization parameters for a routing. Throws on a malformed
 * id or hint, and on a combination WorkOS refuses: an organization with a
 * connection, or a `screenHint` outside AuthKit.
 */
export function workosAuthorizationParams(
  routing: WorkosRouting,
): Record<string, string> {
  const { organizationId, connectionId, loginHint, domainHint, screenHint } =
    routing;
  if (organizationId !== undefined && !ORGANIZATION_ID.test(organizationId)) {
    throw new Error(
      "organizationId must be a WorkOS organization id (org_...)",
    );
  }
  if (connectionId !== undefined && !CONNECTION_ID.test(connectionId)) {
    throw new Error("connectionId must be a WorkOS connection id (conn_...)");
  }
  if (organizationId !== undefined && connectionId !== undefined) {
    throw new Error(
      "Route a WorkOS sign-in by organizationId or connectionId, not both",
    );
  }
  if (loginHint !== undefined && !LOGIN_HINT.test(loginHint)) {
    throw new Error("loginHint must be an email or a username");
  }
  if (domainHint !== undefined && !DOMAIN.test(domainHint)) {
    throw new Error("domainHint must be a domain name");
  }
  const routed = organizationId !== undefined || connectionId !== undefined;
  if (screenHint !== undefined && routed) {
    throw new Error(
      "screenHint applies only to AuthKit, not to a routed sign-in",
    );
  }
  const params: Record<string, string> = {};
  // WorkOS takes exactly one selector: the organization, the connection, or
  // the AuthKit provider.
  if (organizationId !== undefined) params.organization_id = organizationId;
  else if (connectionId !== undefined) params.connection_id = connectionId;
  else params.provider = AUTHKIT_PROVIDER;
  if (loginHint !== undefined) params.login_hint = loginHint;
  if (domainHint !== undefined) params.domain_hint = domainHint.toLowerCase();
  if (screenHint !== undefined) params.screen_hint = screenHint;
  return params;
}

/** App-defined config for setting up the WorkOS provider. */
export type WorkosProviderOptions = {
  /** The WorkOS oauth component instance, i.e. `components.authWorkos`. */
  component: ComponentApi;
  /**
   * Origins `redirectTo` may point at, e.g. `["https://app.example.com"]`
   * for open-redirect prevention.
   */
  allowedRedirectOrigins: string[];
};

/**
 * Built-in WorkOS provider, signing in through WorkOS AuthKit. Wire it up
 * with the WorkOS oauth component:
 *
 * ```ts
 * export const { startSignInWithWorkos, completeSignInWithWorkos } = workos(auth, {
 *   component: components.authWorkos,
 *   allowedRedirectOrigins: ["https://app.example.com", "http://localhost:5173"],
 * }).attachUserCallbacks({ createUser: internal.users.createUserWorkos });
 * ```
 *
 * Setup:
 *
 * 1. Install the component in convex.config.ts under
 *    `httpPrefix: "/oauth/workos"`, binding the WorkOS environment's
 *    `CLIENT_ID` and its API key as `CLIENT_SECRET`.
 * 2. Add `<site-url>/oauth/workos/callback` as a redirect URI in the WorkOS
 *    dashboard.
 *
 * The `httpPrefix` alone determines the callback URL.
 */
export function workos<UsersTable extends string>(
  core: AuthCore<UsersTable>,
  options: WorkosProviderOptions,
) {
  // Validate the app-supplied options up front so mistakes fail at deploy
  // time, not on the first sign-in.
  const allowedOrigins = validateAllowedRedirectOrigins(
    options.allowedRedirectOrigins,
  );

  return {
    /**
     * Supply the app's user callbacks (see {@link UserCallbacks} for how their
     * args must be declared) and get this provider's functions to export.
     */
    attachUserCallbacks(
      callbacks: UserCallbacks<"workos", WorkosProfile, UsersTable>,
    ) {
      const { authMutation } = core.bindMethod({
        name: PROVIDER_NAME,
        createUser: callbacks.createUser,
        onSignIn: callbacks.onSignIn,
      });

      const startSignIn = buildStartSignIn({
        allowedOrigins,
        authorizationEndpoint: AUTHORIZATION_ENDPOINT,
        scopes: SCOPES,
        startArgs: vWorkosRouting,
        authorizationParams: workosAuthorizationParams,
        createAuthorizationRequest:
          options.component.provider.createAuthorizationRequest,
      });

      const completeSignIn = buildCompleteSignIn<
        WorkosProfile,
        { tokenResponse?: WorkosAuthentication }
      >({
        providerName: PROVIDER_NAME,
        authMutation,
        claimTicket: (ctx, args) =>
          ctx.runMutation(options.component.provider.claimTicket, args),
        profile: (payload) => normalizeWorkosProfile(payload.tokenResponse),
      });

      return {
        startSignInWithWorkos: startSignIn,
        completeSignInWithWorkos: completeSignIn,
      };
    },
  };
}

/** A handler the directory sync calls with each change of one kind. */
export type WorkosChangeHandler<Change extends DefaultFunctionArgs> =
  FunctionReference<"mutation", "internal", Change>;

/**
 * The app's handlers, one per kind of WorkOS object it keeps a copy of. Each
 * runs inside the mutation that applies the change, once per change, along
 * with up to a page of others, so it must do a constant amount of work per
 * change and schedule any fan-out. A handler that throws rolls its page back
 * and stops the sync on that event until the handler is fixed.
 */
export type WorkosHandlers = {
  organization?: WorkosChangeHandler<OrganizationChange>;
  membership?: WorkosChangeHandler<MembershipChange>;
  user?: WorkosChangeHandler<UserChange>;
  connection?: WorkosChangeHandler<ConnectionChange>;
  directory?: WorkosChangeHandler<DirectoryChange>;
  directoryUser?: WorkosChangeHandler<DirectoryUserChange>;
  directoryGroup?: WorkosChangeHandler<DirectoryGroupChange>;
  directoryMember?: WorkosChangeHandler<DirectoryMemberChange>;
};

const HANDLER_KINDS = [
  "organization",
  "membership",
  "user",
  "connection",
  "directory",
  "directoryUser",
  "directoryGroup",
  "directoryMember",
] as const;

async function mint<Change extends DefaultFunctionArgs>(
  handler: WorkosChangeHandler<Change> | undefined,
): Promise<string | undefined> {
  return handler === undefined
    ? undefined
    : await createFunctionHandle(handler);
}

type RunQueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
type RunMutationCtx = Pick<GenericMutationCtx<GenericDataModel>, "runMutation">;

/**
 * WorkOS beyond sign-in: the directory sync, which keeps a copy of the
 * WorkOS environment's organizations, users, memberships, SSO connections
 * and SCIM directories in the WorkOS component and hands every change to the
 * app's {@link WorkosHandlers}, and reads of that copy.
 *
 * ```ts
 * export const enterprise = workosEnterprise(components.authWorkos, {
 *   on: {
 *     membership: internal.workos.membership,
 *     directoryUser: internal.workos.directoryUser,
 *   },
 * });
 *
 * // A cron runs it: crons.interval("workos", { minutes: 1 }, internal.workos.sync);
 * export const sync = internalMutation({
 *   args: {},
 *   handler: (ctx) => enterprise.sync(ctx),
 * });
 * ```
 *
 * The first sync fixes a boundary in WorkOS's event stream and lists
 * everything as of then; each later one reads the events since. Run it often:
 * a sync with nothing new reads one row and makes one WorkOS call.
 */
export function workosEnterprise(
  component: ComponentApi,
  options: { on?: WorkosHandlers } = {},
) {
  const on = options.on ?? {};
  for (const key of Object.keys(on)) {
    if (!(HANDLER_KINDS as readonly string[]).includes(key)) {
      throw new Error(`"${key}" is not a kind of WorkOS change`);
    }
  }
  // Only app code can mint a function handle, so every call that may write
  // the copy mints them here and carries them in.
  const handles = async () => ({
    organization: await mint(on.organization),
    membership: await mint(on.membership),
    user: await mint(on.user),
    connection: await mint(on.connection),
    directory: await mint(on.directory),
    directoryUser: await mint(on.directoryUser),
    directoryGroup: await mint(on.directoryGroup),
    directoryMember: await mint(on.directoryMember),
  });

  return {
    /**
     * Start a pass over WorkOS's event stream, unless one is running. Returns
     * whether it started one. Call it from a cron.
     */
    async sync(ctx: RunMutationCtx): Promise<boolean> {
      return await ctx.runMutation(component.stream.sweep, {
        handles: await handles(),
      });
    },

    /**
     * How the sync is doing: whether a pass is pending, how many backfills
     * are open, the failure it stopped on, and the credentials it is bound to,
     * by fingerprint.
     */
    async status(ctx: RunQueryCtx) {
      return await ctx.runQuery(component.directory.status, {});
    },

    /** An organization from the copy, or null if WorkOS has none. */
    async organization(ctx: RunQueryCtx, args: { workosId: string }) {
      return await ctx.runQuery(component.directory.organization, args);
    },

    /** One page of a user's, or an organization's, memberships. */
    async memberships(
      ctx: RunQueryCtx,
      args: {
        of: { user: string } | { organization: string };
        paginationOpts: PaginationOptions;
      },
    ) {
      return await ctx.runQuery(component.directory.memberships, args);
    },

    /** One page of a directory group's members. */
    async members(
      ctx: RunQueryCtx,
      args: { group: string; paginationOpts: PaginationOptions },
    ) {
      return await ctx.runQuery(component.directory.members, args);
    },

    /**
     * Where an email signs in: the organization whose verified domain it is
     * in, and its SSO connection when it has exactly one active. Pass the
     * result to `startSignInWithWorkos`.
     */
    async route(ctx: RunQueryCtx, args: { email: string }) {
      return await ctx.runQuery(component.directory.route, args);
    },
  };
}
