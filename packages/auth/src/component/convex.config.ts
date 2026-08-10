import { defineComponent } from "convex/server";
import actionCache from "@convex-dev/action-cache/convex.config";
import workpool from "@convex-dev/workpool/convex.config";

const component = defineComponent("auth");

component.use(workpool, { name: "webhookWorkpool" });
component.use(actionCache, { name: "connectionFetchCache" });

export default component;
