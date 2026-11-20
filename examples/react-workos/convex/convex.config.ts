import { defineApp } from "convex/server";
import { v } from "convex/values";
import auth from "@convex-dev/auth/convex.config.js";
import authWorkos from "@estifanos-sh/convex-workos/convex.config.js";

const app = defineApp({
  env: {
    AUTH_WORKOS_CLIENT_ID: v.string(),
    AUTH_WORKOS_API_KEY: v.string(),
  },
});

app.use(auth);

// The `httpPrefix` below controls where the component's SSO callback is
// mounted: `<site-url>/workos/callback`, the redirect URI to add in the WorkOS
// dashboard.
app.use(authWorkos, {
  httpPrefix: "/workos",
  env: {
    CLIENT_ID: app.env.AUTH_WORKOS_CLIENT_ID,
    CLIENT_SECRET: app.env.AUTH_WORKOS_API_KEY,
  },
});

export default app;
