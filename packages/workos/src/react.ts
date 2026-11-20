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
 * In a native iOS app, open the `redirect` URL in an
 * `ASWebAuthenticationSession`, not a web view: Google and Microsoft identity
 * providers refuse to sign in inside an embedded web view.
 *
 * @module
 */
"use client";

import { useMemo } from "react";
import {
  type OauthCompleteResult,
  type OauthProviderApi,
  type OauthStartResult,
  type SignInOptions,
  useOauthSignIn,
} from "@convex-dev/auth/methods/oauth/react";
import { addRoute, type WorkosRoute } from "./routing.ts";

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
      const redirectTo = options.redirectTo ?? currentHref();
      if (redirectTo === null) {
        throw new Error(
          "`redirectTo` is required where there is no current page URL, " +
            "such as React Native.",
        );
      }
      return oauthSignIn({ redirectTo: addRoute(redirectTo, options.route) });
    }
    return signIn;
  }, [oauthSignIn]);
  return { signIn };
}

function currentHref(): string | null {
  if (typeof window === "undefined" || window.location === undefined) {
    return null;
  }
  return window.location.href;
}
