import {
  setupWorkosDirectory,
  vWorkosDirectoryChange,
} from "@convex-dev/auth/methods/workos/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation, query } from "./_generated/server";

/**
 * Where an email signs in with SSO, for the sign-in page. Null for an email
 * whose domain no organization verified.
 */
export const route = query({
  args: { email: v.string() },
  returns: v.union(v.null(), v.object({ organizationId: v.string() })),
  handler: async (ctx, args) =>
    await ctx.runQuery(components.authWorkos.directory.route, args),
});

/**
 * Map the directory onto the app's users. This example only acts on
 * deprovisioning: it marks the user and revokes every one of their sessions,
 * so they are signed out everywhere within seconds of the directory's change.
 */
export const onDirectoryChange = internalMutation({
  args: { change: vWorkosDirectoryChange },
  returns: v.null(),
  handler: async (ctx, { change }) => {
    if (change.kind !== "user" || !change.deprovisioned) return null;
    const { organizationId, idpId } = change.user;
    const users = await ctx.db
      .query("users")
      .withIndex("organizationId_idpId", (q) =>
        q.eq("organizationId", organizationId).eq("idpId", idpId),
      )
      .collect();
    for (const user of users) {
      await ctx.db.patch("users", user._id, { deprovisioned: true });
      const sessions = await ctx.runQuery(components.auth.public.listSessions, {
        userId: user._id,
      });
      await ctx.runMutation(components.auth.public.revokeSessions, {
        sessionIds: sessions.map((session) => session.sessionId),
      });
    }
    return null;
  },
});

export const { registerWorkosWebhook, syncWorkosDirectory } =
  setupWorkosDirectory({
    component: components.authWorkos,
    onChange: internal.workos.onDirectoryChange,
  });
