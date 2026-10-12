import { components, internal } from "./_generated/api";
import { convexAuth } from "@convex-dev/auth/server";
import { workos } from "@convex-dev/auth/methods/workos/server";

const auth = convexAuth({ component: components.auth });
export const { signOut, refreshSession, isAuthenticated } = auth;

export const { startSignInWithWorkos, completeSignInWithWorkos } = workos(
  auth,
  {
    component: components.authWorkos,
    allowedRedirectOrigins: ["http://localhost:5173"],
  },
).attachUserCallbacks({ createUser: internal.users.createUser });
