import { getContext, onDestroy, setContext } from "svelte";

import type { AuthState, AuthSubscriber } from "../client/core/types";

/** The lifecycle methods every client binding needs, without widening `signIn`. */
type AuthClient = {
  subscribe: (handler: AuthSubscriber) => () => void;
  getSnapshot: () => AuthState;
  signIn: unknown;
  signOut: () => Promise<void>;
};

const AUTH_CONTEXT = Symbol("convex-auth");

/** Reactive auth state bridged from the client's `subscribe`. Read its fields in markup. */
class ConvexAuth<Client extends AuthClient> {
  #client: Client;
  #unsubscribe: () => void;
  #state = $state<AuthState>({ status: "loading", token: null });

  constructor(client: Client) {
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
  get signIn(): Client["signIn"] {
    return this.#client.signIn;
  }
  get signOut(): Client["signOut"] {
    return this.#client.signOut;
  }
  /** The underlying imperative client, for factor flows (`totp`, `webauthn`, `device`). */
  get client(): Client {
    return this.#client;
  }

  dispose(): void {
    this.#unsubscribe();
  }
}

/**
 * Read reactive auth state for an inferred client.
 *
 * Call this with the same client in the root layout and in descendants. The
 * first call creates the tree's subscription; later calls reuse it.
 *
 * @param client - The client returned by `client({ api: api.auth, ... })`.
 * @returns Reactive state and exact provider-specific client methods.
 */
export function useConvexAuth<const Client extends AuthClient>(client: Client): ConvexAuth<Client> {
  const existing = getContext<ConvexAuth<AuthClient> | undefined>(AUTH_CONTEXT);
  if (existing !== undefined) {
    if (existing.client !== client) {
      throw new Error("Every useConvexAuth() call in one tree must use the same client.");
    }
    return existing as ConvexAuth<Client>;
  }

  const auth = new ConvexAuth(client);
  onDestroy(() => auth.dispose());
  setContext(AUTH_CONTEXT, auth);
  return auth;
}
