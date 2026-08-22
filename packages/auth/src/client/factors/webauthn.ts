/**
 * Platform-neutral WebAuthn client core.
 *
 * Owns the two-phase server handshake shared by every platform: request the
 * ceremony options, run the platform's WebAuthn ceremony via the injected
 * {@link WebAuthnCeremony} hook, then submit the ceremony result. Platform
 * entrypoints (`browser`, `expo`) supply only the ceremony.
 *
 * @module
 */

import type {
  FactorDeps,
  WebAuthnClient,
  WebAuthnRegisterOptions,
  WebAuthnSignInOptions,
  WebAuthnRotationResult,
  WebAuthnContinuationSignInResult,
  SignInActionResult,
  SignInResult,
} from "../core/types";
import type { AuthParameters } from "../../shared/results";

type WebAuthnSignInRequest = {
  request: { provider: "webauthn"; params: AuthParameters };
  verifier?: string;
  continuation?: string;
};

/**
 * Platform-specific WebAuthn ceremony hooks. Each returns the phase-2 params
 * submitted to the server verifier for the corresponding flow.
 *
 * @internal
 */
export interface WebAuthnCeremony {
  /** Runtime capability probes surfaced on the {@link WebAuthnClient}. */
  isSupported(): boolean;
  isAutofillSupported(): Promise<boolean>;
  /**
   * Run the credential-creation ceremony for the given server options and
   * registration hints, returning the phase-2 verification params.
   */
  register(options: unknown, opts: WebAuthnRegisterOptions | undefined): Promise<AuthParameters>;
  /**
   * Run the credential-assertion ceremony for the given server options and
   * sign-in hints, returning the phase-2 verification params.
   */
  signIn(options: unknown, opts: WebAuthnSignInOptions | undefined): Promise<AuthParameters>;
}

/**
 * Build the platform-neutral passkey client around a platform ceremony.
 *
 * @internal
 */
export function createWebAuthnClientCore(
  deps: FactorDeps,
  ceremony: WebAuthnCeremony,
): WebAuthnClient {
  const { proxy, convex, requireApiRefs, proxyFetch, setTokenAndMaybeWait } = deps;

  const requestSignIn = async (
    params: AuthParameters,
    verifier?: string,
    continuation?: string,
  ): Promise<SignInActionResult> => {
    const args: WebAuthnSignInRequest = { request: { provider: "webauthn", params } };
    if (verifier !== undefined) args.verifier = verifier;
    if (continuation !== undefined) args.continuation = continuation;
    if (proxy) {
      return (await proxyFetch({
        action: "auth:signIn",
        args,
      })) as SignInActionResult;
    }
    return (await convex.action(requireApiRefs().signIn, args)) as SignInActionResult;
  };

  const handleSignedInResult = async (
    result: SignInActionResult,
    flow: string,
  ): Promise<SignInResult> => {
    if (result.kind !== "signedIn") {
      return { kind: "started" as const };
    }

    const sessionEstablished = await setTokenAndMaybeWait(
      proxy
        ? {
            shouldStore: false as const,
            tokens: result.session === null ? null : { token: result.session.token },
            waitForHandshake: true,
            context: { provider: "webauthn", flow },
          }
        : {
            shouldStore: true as const,
            tokens: result.session,
            waitForHandshake: true,
            context: { provider: "webauthn", flow },
          },
    );

    return sessionEstablished
      ? ({ kind: "signedIn" as const } satisfies SignInResult)
      : ({ kind: "started" as const } satisfies SignInResult);
  };

  const completeRegistration = async (
    result: WebAuthnRotationResult,
    opts?: WebAuthnRegisterOptions,
  ) => {
    const phase2Params = await ceremony.register(result.options, opts);
    const phase2 = await requestSignIn(phase2Params, result.verifier, result.continuation);
    return await handleSignedInResult(phase2, "rotate");
  };

  const completeSignIn = async (
    result: WebAuthnContinuationSignInResult,
    opts?: WebAuthnSignInOptions,
  ) => {
    const phase2Params = await ceremony.signIn(result.options, opts);
    const phase2 = await requestSignIn(phase2Params, result.verifier, result.continuation);
    return await handleSignedInResult(phase2, "signIn");
  };

  return {
    isSupported: () => ceremony.isSupported(),
    isAutofillSupported: () => ceremony.isAutofillSupported(),

    register: async (opts?: WebAuthnRegisterOptions): Promise<SignInResult> => {
      const phase1 = await requestSignIn({
        flow: "register",
        userName: opts?.userName,
        userDisplayName: opts?.userDisplayName,
      });
      if (phase1.kind !== "webauthnOptions") {
        throw new Error("Server did not return WebAuthn registration options");
      }
      const phase2Params = await ceremony.register(phase1.options, opts);
      const phase2 = await requestSignIn(phase2Params, phase1.verifier);
      return handleSignedInResult(phase2, "verify");
    },

    completeRegistration,
    completeSignIn,

    signIn: async (opts?: WebAuthnSignInOptions): Promise<SignInResult> => {
      const phase1 = await requestSignIn({ flow: "signIn", email: opts?.email });
      if (phase1.kind !== "webauthnOptions") {
        throw new Error("Server did not return WebAuthn authentication options");
      }
      const phase2Params = await ceremony.signIn(phase1.options, opts);
      const phase2 = await requestSignIn(phase2Params, phase1.verifier);
      return handleSignedInResult(phase2, "verify");
    },
  };
}
