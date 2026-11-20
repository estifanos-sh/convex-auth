/**
 * Reads of WorkOS organization domains, as the copy holds them.
 *
 * @module
 */
import { v } from "convex/values";
import { query } from "./_generated/server.ts";
import { find, only, owned } from "./copy.ts";
import {
  vConnection,
  vOrganization,
  vOrganizationDomain,
} from "./validators.ts";

/**
 * Where to send an email address, or a bare domain, to sign in: the
 * organization that verified the domain, with its active SSO connection.
 * Route the sign-in to the organization's `id`. Returns null for a domain
 * that no organization signs in with SSO.
 */
export const get = query({
  args: { domain: v.string() },
  returns: v.union(
    v.null(),
    v.object({ organization: vOrganization, connection: vConnection }),
  ),
  handler: async (ctx, args) => {
    const domain = args.domain.slice(args.domain.lastIndexOf("@") + 1);
    const claims = only(
      "organization_domain",
      await ctx.db
        .query("objects")
        .withIndex("object_domain", (q) =>
          q
            .eq("object", "organization_domain")
            .eq("domain", domain.toLowerCase()),
        )
        .collect(),
    );
    for (const claim of claims) {
      if (claim.state !== "verified") continue;
      const organization = await find(
        ctx.db,
        "organization",
        claim.organization_id,
      );
      const connection = (
        await owned(ctx.db, "connection", claim.organization_id)
      ).find((each) => each.state === "active");
      if (organization !== null && connection !== undefined) {
        return { organization, connection };
      }
    }
    return null;
  },
});

/** An organization's domains. An organization holds a handful. */
export const list = query({
  args: { organizationId: v.string() },
  returns: v.array(vOrganizationDomain),
  handler: async (ctx, args) =>
    await owned(ctx.db, "organization_domain", args.organizationId),
});
