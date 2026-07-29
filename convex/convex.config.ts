import resend from "@convex-dev/resend/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import auth from "@robelest/convex-auth/convex.config";
import { authEnv } from "@robelest/convex-auth/server";
import { defineApp } from "convex/server";

const app = defineApp({
  env: authEnv,
});

app.use(auth);
app.use(resend);
app.use(staticHosting, { name: "staticHosting" });
app.use(staticHosting, { name: "docsHosting" });

export default app;
