import { setupConvexAuth } from "@convex-dev/auth/server";
import { setupWorkos } from "@estifanos-sh/convex-workos/server";
import { components, internal } from "./_generated/api";

// The `workos` method of a host that provisions users, on a core of its own,
// since one core binds a method name once. The examples give
// `api.provisioned` to `useProvisionedSignInWithWorkos`.

const auth = setupConvexAuth({ component: components.auth });

export const {
  startSignInWithWorkos,
  completeSignInWithWorkos,
  finishSignInWithWorkos,
} = setupWorkos(auth, {
  component: components.authWorkos,
  allowedRedirectOrigins: ["http://localhost:5173"],
}).attachProvisionedUserCallbacks({
  createUser: internal.users.createUserWorkos,
  provision: internal.users.provisionWorkos,
});
