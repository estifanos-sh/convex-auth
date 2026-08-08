import { getContext, onDestroy, setContext } from "svelte";

import type { AuthApiRefs, AuthClient } from "../browser/index";
import type { AuthState, SignInOverloads } from "../client/core/types";

type AnyAuthClient = AuthClient<AuthApiRefs<boolean, boolean, boolean>>;

const AUTH_KEY = Symbol("convex-auth");

/** Reactive auth state bridged from the client's `subscribe`. Read its fields in markup. */
export class ConvexAuth {
  #client: AnyAuthClient;
  #unsubscribe: () => void;
  #state = $state<AuthState>({ status: "loading", token: null });

  constructor(client: AnyAuthClient) {
    this.#client = client;
    this.#unsubscribe = client.subscribe((state) => {
      this.#state = state;
    });
  }

  /** The discriminated auth state; narrow on `.status` to reach `token`. */
  get state(): AuthState {
    return this.#state;
  }
  get status(): AuthState["status"] {
    return this.#state.status;
  }
  get signedIn(): boolean {
    return this.#state.status === "signedIn";
  }
  get signedOut(): boolean {
    return this.#state.status === "signedOut";
  }
  get loading(): boolean {
    return this.#state.status === "loading";
  }
  get token(): string | null {
    return this.#state.token;
  }
  get signIn(): SignInOverloads {
    return this.#client.signIn;
  }
  get signOut(): () => Promise<void> {
    return this.#client.signOut;
  }
  /** The underlying imperative client, for factor flows (`totp`, `webauthn`, `device`). */
  get client(): AnyAuthClient {
    return this.#client;
  }

  dispose(): void {
    this.#unsubscribe();
  }
}

/** Expose an app-owned auth client as reactive `ConvexAuth` and share it via context. */
export function setupConvexAuth(client: AnyAuthClient): ConvexAuth {
  const auth = new ConvexAuth(client);
  onDestroy(() => auth.dispose());
  setContext(AUTH_KEY, auth);
  return auth;
}

/** Read the reactive auth shared by {@link setupConvexAuth} from a descendant component. */
export function useConvexAuth(): ConvexAuth {
  const auth = getContext<ConvexAuth | undefined>(AUTH_KEY);
  if (auth === undefined) {
    throw new Error(
      "useConvexAuth() must be called under a component tree that ran setupConvexAuth().",
    );
  }
  return auth;
}
