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
 * ```
 *
 * @module
 */
"use client";

import type { OauthProviderApi } from "../oauth/client.ts";
import { useOauthSignIn, type UseOauthSignInReturn } from "../oauth/react.ts";

export { useOauth, type UseOauthReturn } from "../oauth/react.ts";
export type {
  OauthCompleteResult,
  OauthFlowError,
  OauthStartResult,
  SignInOptions,
} from "../oauth/client.ts";

/** What {@link useSignInWithWorkos} returns. */
export type UseSignInWithWorkosReturn = {
  /** Start WorkOS's OAuth flow. See {@link UseOauthSignInReturn.signIn}. */
  signIn: UseOauthSignInReturn["signIn"];
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
  const { signIn } = useOauthSignIn({
    providerName: "workos",
    startSignIn: api.startSignInWithWorkos,
    completeSignIn: api.completeSignInWithWorkos,
  });
  return { signIn };
}
