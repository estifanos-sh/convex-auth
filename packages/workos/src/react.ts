/**
 * React client for the WorkOS sign-in method, exported at
 * `@estifanos-sh/convex-workos/react`.
 *
 * {@link useSignInWithWorkos} starts an SSO sign-in, routed to an
 * organization or a connection. {@link useOauth} returns the state that is
 * shared by all the OAuth methods, for example the error of the last flow.
 *
 * ```tsx
 * const { signIn } = useSignInWithWorkos(api.auth);
 * const { flowError } = useOauth();
 *
 * await signIn({
 *   route: {
 *     kind: "organization",
 *     organizationId: "org_...",
 *     loginHint: "ada@example.com",
 *   },
 * });
 * ```
 *
 * A host that provisions users on the server registers {@link workos} in place of
 * `oauth()` and signs in with {@link useProvisionedSignInWithWorkos}, which
 * also finishes a sign-in the app deferred.
 *
 * In a native iOS app, open the `redirect` URL in an
 * `ASWebAuthenticationSession`, not a web view: Google and Microsoft identity
 * providers refuse to sign in inside an embedded web view.
 *
 * @module
 */
"use client";

import { getFunctionName } from "convex/server";
import { useMemo } from "react";
import {
  type OauthCompleteResult,
  type OauthFlowError,
  type OauthProviderApi,
  type OauthStartResult,
  type SignInOptions,
  useOauthSignIn,
} from "@convex-dev/auth/methods/oauth/react";
import { useAmbientSignInValue } from "@convex-dev/auth/react/methods";
import {
  currentHref,
  type ProvisionedWorkosApi,
  type WorkosActions,
  type WorkosCompleteResult,
  WORKOS_KEYS,
  WORKOS_SETUP_ID,
} from "./client.ts";
import { addRoute, type WorkosRoute } from "./routing.ts";

export {
  workos,
  type ProvisionedWorkosApi,
  type WorkosCompleteResult,
} from "./client.ts";

export { addRoute, type WorkosHints, type WorkosRoute } from "./routing.ts";
export {
  useOauth,
  type OauthCompleteResult,
  type OauthFlowError,
  type OauthStartResult,
  type SignInOptions,
  type UseOauthReturn,
} from "@convex-dev/auth/methods/oauth/react";

/** What starting a WorkOS sign-in takes. */
export type WorkosSignInOptions = Omit<SignInOptions, "code"> & {
  /** Where the sign-in goes: an organization or a connection. */
  route: WorkosRoute;
  code?: undefined;
};

/** What {@link useSignInWithWorkos} returns. */
export type UseSignInWithWorkosReturn = {
  /**
   * Start an SSO sign-in to its {@link WorkosRoute}, an organization or a
   * connection, or, with `code`, finish one started elsewhere. See
   * `useOauthSignIn`.
   */
  signIn: {
    (options: SignInOptions & { code: string }): Promise<OauthCompleteResult>;
    (options: WorkosSignInOptions): Promise<OauthStartResult>;
  };
};

/**
 * Sign in with WorkOS SSO. Pass the module exporting the functions of the
 * method (usually the generated `api.auth`), or an object mapping the
 * canonical keys to renamed exports.
 */
export function useSignInWithWorkos(api: {
  startSignInWithWorkos: OauthProviderApi["startSignIn"];
  completeSignInWithWorkos: OauthProviderApi["completeSignIn"];
}): UseSignInWithWorkosReturn {
  const { signIn: oauthSignIn } = useOauthSignIn({
    providerName: "workos",
    startSignIn: api.startSignInWithWorkos,
    completeSignIn: api.completeSignInWithWorkos,
  });
  const signIn = useMemo(() => {
    function signIn(
      options: SignInOptions & { code: string },
    ): Promise<OauthCompleteResult>;
    function signIn(options: WorkosSignInOptions): Promise<OauthStartResult>;
    function signIn(
      options: (SignInOptions & { code: string }) | WorkosSignInOptions,
    ): Promise<OauthCompleteResult | OauthStartResult> {
      if (options.code !== undefined) {
        return oauthSignIn({
          redirectTo: options.redirectTo,
          code: options.code,
        });
      }
      return oauthSignIn({ redirectTo: startTarget(options) });
    }
    return signIn;
  }, [oauthSignIn]);
  return { signIn };
}

/** What {@link useProvisionedSignInWithWorkos} returns. */
export type UseProvisionedSignInWithWorkosReturn = {
  /**
   * Start an SSO sign-in to its {@link WorkosRoute}, or, with `code`, redeem
   * one started elsewhere. A code redeemed on the page the callback returns
   * to reports through `flowError` and `deferredTicket`.
   */
  signIn: {
    (options: SignInOptions & { code: string }): Promise<WorkosCompleteResult>;
    (options: WorkosSignInOptions): Promise<OauthStartResult>;
  };
  /**
   * Finish a sign-in the app deferred. It adopts the session once the app
   * provisioned the user, and resolves to `deferred` with the same ticket
   * while the app still defers.
   */
  finish: (ticket: string) => Promise<WorkosCompleteResult>;
  /** Why the last flow failed after the redirect back, or `null`. */
  flowError: OauthFlowError | null;
  /**
   * The ticket of the last sign-in the app deferred, or `null` once a
   * redemption completes or fails.
   */
  deferredTicket: string | null;
};

/**
 * Sign in with WorkOS SSO, for a host that provisions users on the server,
 * so a sign-in can wait while the app provisions the user. Register
 * {@link workos} in `ConvexAuthProvider`'s `ambientSignIns` in place of
 * `oauth()`. It runs on the SPA session model only.
 *
 * ```tsx
 * const { signIn, finish, deferredTicket } = useProvisionedSignInWithWorkos(
 *   api.provisioned,
 * );
 *
 * await signIn({ route: { kind: "organization", organizationId: "org_..." } });
 *
 * // On the page the callback returns to, once the app provisioned the user:
 * if (deferredTicket !== null) await finish(deferredTicket);
 * ```
 */
export function useProvisionedSignInWithWorkos(
  api: ProvisionedWorkosApi,
): UseProvisionedSignInWithWorkosReturn {
  const actions = useAmbientSignInValue<WorkosActions>(
    WORKOS_SETUP_ID,
    WORKOS_KEYS.actions,
  );
  const flowError = useAmbientSignInValue<OauthFlowError | null>(
    WORKOS_SETUP_ID,
    WORKOS_KEYS.flowError,
  );
  const deferredTicket = useAmbientSignInValue<string | null>(
    WORKOS_SETUP_ID,
    WORKOS_KEYS.deferredTicket,
  );
  // Generated api objects make a fresh reference on every property access,
  // so the memo is keyed on the function paths.
  const paths = [
    getFunctionName(api.startSignInWithWorkos),
    getFunctionName(api.completeSignInWithWorkos),
    getFunctionName(api.finishSignInWithWorkos),
  ].join();
  const bound = useMemo(() => {
    if (actions === undefined) {
      throw new Error(
        "No WorkOS client is registered. Pass workos() from " +
          "@estifanos-sh/convex-workos/react to ConvexAuthProvider's " +
          "`ambientSignIns`, in place of oauth().",
      );
    }
    return bind(actions, api);
  }, [actions, paths]);
  return {
    ...bound,
    flowError: flowError ?? null,
    deferredTicket: deferredTicket ?? null,
  };
}

/** The hook's actions, bound to the host's functions. */
function bind(
  actions: WorkosActions,
  api: ProvisionedWorkosApi,
): Pick<UseProvisionedSignInWithWorkosReturn, "signIn" | "finish"> {
  function signIn(
    options: SignInOptions & { code: string },
  ): Promise<WorkosCompleteResult>;
  function signIn(options: WorkosSignInOptions): Promise<OauthStartResult>;
  function signIn(
    options: (SignInOptions & { code: string }) | WorkosSignInOptions,
  ): Promise<WorkosCompleteResult | OauthStartResult> {
    if (options.code !== undefined) {
      return actions.redeem(options.code);
    }
    return actions.start(api, startTarget(options));
  }
  return { signIn, finish: (ticket) => actions.finish(api, ticket) };
}

/** Where a start returns to: `redirectTo`, routed (see `addRoute`). */
function startTarget(options: WorkosSignInOptions): string {
  const redirectTo = options.redirectTo ?? currentHref();
  if (redirectTo === null) {
    throw new Error(
      "`redirectTo` is required where there is no current page URL, " +
        "such as React Native.",
    );
  }
  return addRoute(redirectTo, options.route);
}
