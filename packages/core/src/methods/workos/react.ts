/**
 * React client for the WorkOS sign-in method, exported at
 * `@convex-dev/auth/methods/workos/react`.
 *
 * {@link useSignInWithWorkos} starts the sign-in. {@link useOauth} returns the
 * state that is shared by all the OAuth methods, for example the error of the
 * last flow.
 *
 * ```tsx
 * const { signIn } = useSignInWithWorkos(api.auth);
 * const { flowError } = useOauth();
 *
 * // Straight to a customer's SSO, skipping AuthKit's own page:
 * await signIn({ organizationId: "org_..." });
 * ```
 *
 * @module
 */
"use client";

import { useMemo } from "react";
import type {
  OauthCompleteResult,
  OauthProviderApi,
  OauthStartResult,
  SignInOptions,
} from "../oauth/client.ts";
import { useOauthSignIn } from "../oauth/react.ts";
import type { WorkosRouting } from "./server.ts";

export type { WorkosRouting };

export { useOauth, type UseOauthReturn } from "../oauth/react.ts";
export type {
  OauthCompleteResult,
  OauthFlowError,
  OauthStartResult,
  SignInOptions,
} from "../oauth/client.ts";

/** What {@link useSignInWithWorkos} returns. */
export type UseSignInWithWorkosReturn = {
  /**
   * Start WorkOS's OAuth flow, routed by the {@link WorkosRouting} fields, or
   * with `code`, finish one started elsewhere. See
   * `useOauthSignIn`.
   */
  signIn: {
    (options: SignInOptions & { code: string }): Promise<OauthCompleteResult>;
    (
      options?: Omit<SignInOptions, "code" | "startArgs"> &
        WorkosRouting & { code?: undefined },
    ): Promise<OauthStartResult>;
  };
};

/**
 * Sign in with WorkOS. Pass the module exporting the provider's functions
 * (usually the generated `api.auth`), or an object mapping the canonical keys
 * to renamed exports.
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
  const signIn = useMemo(
    () =>
      ((
        options: SignInOptions &
          WorkosRouting & { code?: string | undefined } = {},
      ) => {
        const {
          organizationId,
          connectionId,
          loginHint,
          domainHint,
          screenHint,
          ...rest
        } = options;
        const routing = {
          organizationId,
          connectionId,
          loginHint,
          domainHint,
          screenHint,
        };
        // Only the fields the caller set: an `undefined` would fail the
        // start mutation's validator.
        const startArgs = Object.fromEntries(
          Object.entries(routing).filter(([, value]) => value !== undefined),
        ) as Record<string, string>;
        return oauthSignIn({ ...rest, startArgs } as SignInOptions & {
          code: string;
        });
      }) as UseSignInWithWorkosReturn["signIn"],
    [oauthSignIn],
  );
  return { signIn };
}
