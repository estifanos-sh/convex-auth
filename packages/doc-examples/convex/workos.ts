import {
  setupWorkosDirectory,
  vWorkosDirectoryChange,
} from "@convex-dev/auth/methods/workos/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

// The handler of the WorkOS directory sync. An app maps each change onto its
// own users and roles here.

export const onDirectoryChange = internalMutation({
  args: { change: vWorkosDirectoryChange },
  returns: v.null(),
  handler: async () => null,
});

export const { registerWorkosWebhook, syncWorkosDirectory } =
  setupWorkosDirectory({
    component: components.authWorkos,
    onChange: internal.workos.onDirectoryChange,
  });
