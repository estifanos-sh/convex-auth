import { api } from "$convex/_generated/api";
import { client as createAuthClient, type AuthClient } from "@estifanos-sh/convex-auth/expo";
import type { AuthState, SignInResult } from "@estifanos-sh/convex-auth/client";
import React from "react";

import { getClient } from "./client";

type DemoAuthClient = AuthClient<typeof api.auth>;
type AuthParameters = Record<string, string | number | boolean | undefined>;

type DemoAuthContextValue = {
  auth: DemoAuthClient;
  state: AuthState;
  signIn: (provider: string, params?: AuthParameters) => Promise<SignInResult>;
  signOut: () => Promise<void>;
};

const DemoAuthContext = React.createContext<DemoAuthContextValue | null>(null);

let authSingleton: DemoAuthClient | null = null;

function getAuthClient(): DemoAuthClient {
  authSingleton ??= createAuthClient({
    convex: getClient(),
    api: api.auth,
    authSession: {
      redirectUri: "demoexpo://auth",
      scheme: "demoexpo",
    },
  });
  return authSingleton;
}

export function DemoAuthProvider({ children }: { children: React.ReactNode }) {
  const auth = React.useMemo(() => getAuthClient(), []);
  const [state, setState] = React.useState<AuthState>({ status: "loading", token: null });

  React.useEffect(() => auth.subscribe(setState), [auth]);

  const value = React.useMemo<DemoAuthContextValue>(
    () => ({
      auth,
      state,
      signIn: auth.signIn,
      signOut: auth.signOut,
    }),
    [auth, state],
  );

  return <DemoAuthContext.Provider value={value}>{children}</DemoAuthContext.Provider>;
}

export function useDemoAuth() {
  const value = React.useContext(DemoAuthContext);
  if (!value) {
    throw new Error("useDemoAuth must be used within DemoAuthProvider");
  }
  return value;
}
