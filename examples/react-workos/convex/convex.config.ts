import { defineApp } from "convex/server";
import { v } from "convex/values";
import auth from "@convex-dev/auth/convex.config.js";
import workos from "@convex-dev/auth/components/workos/convex.config.js";

const app = defineApp({
  env: {
    AUTH_PRIVATE_KEY: v.string(),
    AUTH_JWKS: v.string(),
    AUTH_WORKOS_CLIENT_ID: v.string(),
    AUTH_WORKOS_API_KEY: v.string(),
  },
});

app.use(auth, {
  httpPrefix: "/auth",
  env: {
    AUTH_PRIVATE_KEY: app.env.AUTH_PRIVATE_KEY,
    AUTH_JWKS: app.env.AUTH_JWKS,
  },
});

// The `httpPrefix` below controls where the component's `callback` route is
// mounted. That gets combined with the `CONVEX_SITE_URL` to form the full
// redirect URI that needs to be set on the remote identity provider config.
//
// The full redirect URI will be something like:
//
// https://happy-animal-123.convex.site/oauth/workos/callback
app.use(workos, {
  httpPrefix: "/oauth/workos",
  env: {
    CLIENT_ID: app.env.AUTH_WORKOS_CLIENT_ID,
    CLIENT_SECRET: app.env.AUTH_WORKOS_API_KEY,
  },
});

export default app;
