import { components, internal } from "./_generated/api";
import { setupConvexAuth } from "@convex-dev/auth/server";
import { setupWorkos } from "@estifanos-sh/convex-workos/server";

const auth = setupConvexAuth({ component: components.auth });
export const { signOut, refreshSession, isAuthenticated } = auth;

export const { startSignInWithWorkos, completeSignInWithWorkos } = setupWorkos(
  auth,
  {
    component: components.authWorkos,
    allowedRedirectOrigins: ["http://localhost:5173"],
  },
).attachUserCallbacks({
  createUser: internal.users.createUser,
  onSignIn: internal.users.onSignIn,
});
