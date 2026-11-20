import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction, internalMutation, query } from "./_generated/server";
import { deprovision } from "./users";

/**
 * Where an email signs in with SSO, for the sign-in page. Null for an email
 * whose domain no organization verified.
 */
export const route = query({
  args: { email: v.string() },
  returns: v.union(v.null(), v.object({ organizationId: v.string() })),
  handler: async (ctx, { email }) => {
    const found = await ctx.runQuery(
      components.authWorkos.organizationDomains.get,
      { domain: email },
    );
    return found === null ? null : { organizationId: found.organization.id };
  },
});

/**
 * Bring the component's copy of WorkOS up to date, a page at a time. Two
 * syncs at once land each page once.
 */
export const sync = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (;;) {
      const pulled = await ctx.runAction(components.authWorkos.events.pull, {});
      if (pulled === null) return null;
      await ctx.runMutation(internal.workos.land, { until: pulled.until });
    }
  },
});

/**
 * Land a page and map its changes onto the app's users, in one transaction.
 * This example only acts on deprovisioning: it marks the user and revokes
 * every one of their sessions, so they are signed out everywhere.
 */
export const land = internalMutation({
  args: { until: v.string() },
  returns: v.null(),
  handler: async (ctx, { until }) => {
    const changes = await ctx.runMutation(components.authWorkos.events.land, {
      until,
    });
    for (const change of changes) {
      switch (change.event) {
        case "dsync.user.updated":
          if (change.data.state !== "active") {
            await deprovision(ctx, change.data);
          }
          break;
        case "dsync.user.deleted":
          await deprovision(ctx, change.data);
          break;
      }
    }
    return null;
  },
});
