import { createAuthContext } from "@estifanos-sh/convex-auth/core";

import { components } from "../_generated/api";
import { permissions } from "../roles";

export const auth = createAuthContext(components.auth, {
  permissions,
});
