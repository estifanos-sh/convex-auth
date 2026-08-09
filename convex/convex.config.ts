import resend from "@convex-dev/resend/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import auth from "@estifanos-sh/convex-auth/convex.config";
import { authEnv } from "@estifanos-sh/convex-auth/server";
import { defineApp } from "convex/server";

const app = defineApp({
  env: authEnv,
});

app.use(auth);
app.use(resend);
app.use(staticHosting, { name: "staticHosting" });

export default app;
