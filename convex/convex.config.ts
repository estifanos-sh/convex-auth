import resend from "@convex-dev/resend/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import auth from "@estifanos-sh/convex-auth/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    APP_URL: v.optional(v.string()),
    GOOGLE_CLIENT_ID: v.optional(v.string()),
    GOOGLE_CLIENT_SECRET: v.optional(v.string()),
    RESEND_API_KEY: v.optional(v.string()),
    SESSION_INACTIVE_DURATION_MS: v.optional(v.string()),
    SESSION_TOTAL_DURATION_MS: v.optional(v.string()),
  },
});

app.use(auth);
app.use(resend);
app.use(staticHosting, { name: "staticHosting" });

export default app;
