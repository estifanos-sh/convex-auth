/**
 * Reads of WorkOS directory users, as the copy holds them. A user's roles are
 * its own `role` and `roles`, as WorkOS assigns them from group memberships.
 *
 * @module
 */
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server.ts";
import { find, pageOf } from "./copy.ts";
import { vDirectoryUser } from "./validators.ts";

export const get = query({
  args: { id: v.string() },
  returns: v.union(v.null(), vDirectoryUser),
  handler: async (ctx, args) => await find(ctx.db, "directory_user", args.id),
});

/**
 * Directory users, filtered like WorkOS's own listing: by `directory`, by
 * `organization` (and `idpId` within it), by `idpId`, or by `email`. An SSO
 * profile carries the same organization and `idp_id`, which is how a
 * signed-in user is matched to their directory user.
 */
export const list = query({
  args: {
    filter: v.union(
      v.object({ directory: v.string() }),
      v.object({ organization: v.string(), idpId: v.optional(v.string()) }),
      v.object({ idpId: v.string() }),
      v.object({ email: v.string() }),
    ),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(vDirectoryUser),
  handler: async (ctx, { filter, paginationOpts: { numItems, cursor } }) => {
    const objects = ctx.db.query("objects");
    const user = "directory_user";
    const rows =
      "directory" in filter
        ? objects.withIndex("object_directory_id_id", (q) => {
            const users = q
              .eq("object", user)
              .eq("directory_id", filter.directory);
            return cursor === null ? users : users.gt("id", cursor);
          })
        : "organization" in filter
          ? filter.idpId === undefined
            ? objects.withIndex("object_organization_id_id", (q) => {
                const users = q
                  .eq("object", user)
                  .eq("organization_id", filter.organization);
                return cursor === null ? users : users.gt("id", cursor);
              })
            : objects.withIndex("object_organization_id_idp_id_id", (q) => {
                const users = q
                  .eq("object", user)
                  .eq("organization_id", filter.organization)
                  .eq("idp_id", filter.idpId);
                return cursor === null ? users : users.gt("id", cursor);
              })
          : "idpId" in filter
            ? objects.withIndex("object_idp_id_id", (q) => {
                const users = q.eq("object", user).eq("idp_id", filter.idpId);
                return cursor === null ? users : users.gt("id", cursor);
              })
            : objects.withIndex("object_email_id", (q) => {
                const users = q
                  .eq("object", user)
                  .eq("email", filter.email.toLowerCase());
                return cursor === null ? users : users.gt("id", cursor);
              });
    return await pageOf(user, rows, numItems);
  },
});
