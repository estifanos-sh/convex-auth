/**
 * Managing WorkOS organizations and their memberships.
 *
 * Each function changes WorkOS and returns what WorkOS returned; none writes
 * the copy. It starts a sync instead, and the directory sync, the copy's only
 * writer, applies WorkOS's own event for the change, so the copy and the
 * app's handlers see it exactly once and in order.
 *
 * @module
 */
import { ConvexError, v } from "convex/values";
import {
  type Handles,
  type Membership,
  type Organization,
  type Update,
  vHandles,
  vMembership,
  vOrganization,
} from "./changes.ts";
import { Credentials } from "./credentials.ts";
import { decodeItem, decodeList } from "./wire.ts";
import { Api } from "./workosApi.ts";
import { api } from "./_generated/api.ts";
import type { ActionCtx } from "./_generated/server.ts";
import { action } from "./_generated/server.ts";

const vDomainData = v.array(
  v.object({
    domain: v.string(),
    state: v.union(v.literal("pending"), v.literal("verified")),
  }),
);

async function sweep(ctx: ActionCtx, handles: Handles): Promise<void> {
  await ctx.runMutation(api.stream.sweep, { handles });
}

function organization(update: Update): Organization {
  if (update.kind !== "organization") throw unreadable();
  return update.row;
}

function membership(update: Update): Membership {
  if (update.kind !== "membership") throw unreadable();
  return update.row;
}

function unreadable() {
  return new ConvexError({
    code: "WORKOS_UNREADABLE",
    message: "WorkOS returned an object this component cannot read",
    status: 502,
  });
}

export const createOrganization = action({
  args: {
    name: v.string(),
    domains: v.optional(vDomainData),
    externalId: v.optional(v.string()),
    handles: vHandles,
  },
  returns: vOrganization,
  handler: async (ctx, args) => {
    const reply = await new Api(Credentials.read()).send(
      "POST",
      "/organizations",
      {
        name: args.name,
        domain_data: args.domains,
        external_id: args.externalId,
      },
    );
    await sweep(ctx, args.handles);
    return organization(
      decodeItem("organizations", reply.body, "", reply.date),
    );
  },
});

export const updateOrganization = action({
  args: {
    organization: v.string(),
    name: v.optional(v.string()),
    domains: v.optional(vDomainData),
    externalId: v.optional(v.string()),
    handles: vHandles,
  },
  returns: vOrganization,
  handler: async (ctx, args) => {
    const reply = await new Api(Credentials.read()).send(
      "PUT",
      `/organizations/${encodeURIComponent(args.organization)}`,
      {
        name: args.name,
        domain_data: args.domains,
        external_id: args.externalId,
      },
    );
    await sweep(ctx, args.handles);
    return organization(
      decodeItem("organizations", reply.body, "", reply.date),
    );
  },
});

export const createMembership = action({
  args: {
    user: v.string(),
    organization: v.string(),
    role: v.optional(v.string()),
    handles: vHandles,
  },
  returns: vMembership,
  handler: async (ctx, args) => {
    const reply = await new Api(Credentials.read()).send(
      "POST",
      "/user_management/organization_memberships",
      {
        user_id: args.user,
        organization_id: args.organization,
        role_slug: args.role,
      },
    );
    await sweep(ctx, args.handles);
    return membership(decodeItem("memberships", reply.body, "", reply.date));
  },
});

export const updateMembership = action({
  args: { membership: v.string(), role: v.string(), handles: vHandles },
  returns: vMembership,
  handler: async (ctx, args) => {
    const reply = await new Api(Credentials.read()).send(
      "PUT",
      `/user_management/organization_memberships/${encodeURIComponent(args.membership)}`,
      { role_slug: args.role },
    );
    await sweep(ctx, args.handles);
    return membership(decodeItem("memberships", reply.body, "", reply.date));
  },
});

export const deleteMembership = action({
  args: { membership: v.string(), handles: vHandles },
  returns: v.null(),
  handler: async (ctx, args) => {
    await new Api(Credentials.read()).send(
      "DELETE",
      `/user_management/organization_memberships/${encodeURIComponent(args.membership)}`,
    );
    await sweep(ctx, args.handles);
    return null;
  },
});

/**
 * A user's membership of an organization as WorkOS holds it now, read from
 * WorkOS rather than the copy, or null if they have none. For an
 * authorization that can't wait for the next sync, like who may open the
 * Admin Portal.
 */
export const fetchMembership = action({
  args: { user: v.string(), organization: v.string() },
  returns: v.union(v.null(), vMembership),
  handler: async (_ctx, args) => {
    const reply = await new Api(Credentials.read()).get(
      "/user_management/organization_memberships",
      {
        user_id: args.user,
        organization_id: args.organization,
        "statuses[]": ["active", "inactive", "pending"],
        limit: "10",
      },
    );
    const list = decodeList(reply.body);
    const found = list.items
      .map((item) =>
        membership(decodeItem("memberships", item, "", reply.date)),
      )
      .find(
        (row) =>
          row.user === args.user && row.organization === args.organization,
      );
    return found ?? null;
  },
});
