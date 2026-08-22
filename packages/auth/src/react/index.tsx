/**
 * React bindings for `@estifanos-sh/convex-auth/react`.
 *
 * @module
 */

"use client";

import { useCallback, useSyncExternalStore, type ReactElement, type ReactNode } from "react";

import type { AuthState, AuthSubscriber } from "../client/core/types";

/** The lifecycle methods React needs to observe auth state. */
type AuthClient = {
  subscribe: (handler: AuthSubscriber) => () => void;
  getSnapshot: () => AuthState;
};

type AuthStateBoundaryProps<Client extends AuthClient> = {
  client: Client;
  children: ReactNode;
};

type SignedInProps<Client extends AuthClient> = AuthStateBoundaryProps<Client> & {
  children: ReactNode | ((token: string) => ReactNode);
};

/**
 * Subscribe to an inferred auth client.
 *
 * @param client - The client returned by `client({ api: api.auth, ... })`.
 * @returns The current auth state.
 */
export function useAuth<const Client extends AuthClient>(client: Client): AuthState {
  const subscribe = useCallback(
    (onStoreChange: () => void) => client.subscribe(onStoreChange),
    [client],
  );
  const getSnapshot = useCallback(() => client.getSnapshot(), [client]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Render children only while the client is signed in.
 *
 * @param props - The auth client and content to render.
 * @returns The signed-in content, or nothing while signed out or loading.
 */
export function SignedIn<const Client extends AuthClient>({
  client,
  children,
}: SignedInProps<Client>): ReactElement | null {
  const state = useAuth(client);
  if (state.status !== "signedIn") return null;
  return <>{typeof children === "function" ? children(state.token) : children}</>;
}

/**
 * Render children only while the client is signed out.
 *
 * @param props - The auth client and content to render.
 * @returns The signed-out content, or nothing while signed in or loading.
 */
export function SignedOut<const Client extends AuthClient>({
  client,
  children,
}: AuthStateBoundaryProps<Client>): ReactElement | null {
  return useAuth(client).status === "signedOut" ? <>{children}</> : null;
}

/**
 * Render children while the client is restoring its session.
 *
 * @param props - The auth client and content to render.
 * @returns The loading content, or nothing once auth resolves.
 */
export function AuthLoading<const Client extends AuthClient>({
  client,
  children,
}: AuthStateBoundaryProps<Client>): ReactElement | null {
  return useAuth(client).status === "loading" ? <>{children}</> : null;
}
