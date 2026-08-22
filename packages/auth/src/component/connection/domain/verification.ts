/**
 * `component.connection.domain.verification.*` — domain
 * ownership-proof records (sub-resource of connection.domain).
 *
 * @module
 */

import { v } from "convex/values";

import { mutation, query } from "../../_generated/server";
import { vGroupConnectionDomainVerificationDoc } from "../../documents";

/** Read a domain's verification record by `domainId`, or `null` if none. */
export const get = query({
  args: { domainId: v.id("GroupConnectionDomain") },
  returns: v.union(vGroupConnectionDomainVerificationDoc, v.null()),
  handler: async (ctx, { domainId }) => {
    return await ctx.db
      .query("GroupConnectionDomainVerification")
      .withIndex("domain_id", (idx) => idx.eq("domainId", domainId))
      .first();
  },
});

/** Insert a verification record, or patch it when one already exists for the domain (keyed by `domainId`). */
export const upsert = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    domainId: v.id("GroupConnectionDomain"),
    domain: v.string(),
    recordName: v.string(),
    token: v.string(),
    tokenHash: v.string(),
    requestedAt: v.number(),
    expiresAt: v.number(),
  },
  returns: v.id("GroupConnectionDomainVerification"),
  handler: async (ctx, args) => {
    const { connectionId, ...rest } = args;
    const existing = await ctx.db
      .query("GroupConnectionDomainVerification")
      .withIndex("domain_id", (idx) => idx.eq("domainId", args.domainId))
      .first();
    if (existing) {
      await ctx.db.patch("GroupConnectionDomainVerification", existing._id, {
        connectionId: connectionId,
        ...rest,
      });
      return existing._id;
    }
    return await ctx.db.insert("GroupConnectionDomainVerification", {
      connectionId: connectionId,
      ...rest,
    });
  },
});

/** Delete a domain's verification record, if any. */
const remove = mutation({
  args: { domainId: v.id("GroupConnectionDomain") },
  returns: v.null(),
  handler: async (ctx, { domainId }) => {
    const existing = await ctx.db
      .query("GroupConnectionDomainVerification")
      .withIndex("domain_id", (idx) => idx.eq("domainId", domainId))
      .first();
    if (existing) {
      await ctx.db.delete("GroupConnectionDomainVerification", existing._id);
    }
    return null;
  },
});

export { remove };
