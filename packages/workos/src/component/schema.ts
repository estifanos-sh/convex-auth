import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  accountsTable,
  authorizationRequestsTable,
  ticketsTable,
} from "@convex-dev/auth/lib/oauth/schema";
import { vPosition } from "./fill.ts";
import { vObject, vWorkosEvent } from "./validators.ts";

export default defineSchema({
  authorizationRequests: authorizationRequestsTable,
  tickets: ticketsTable,
  accounts: accountsTable,

  /**
   * The copy: every object of the environment, in one table, tagged by
   * WorkOS's `object`. WorkOS's ids are unique across kinds.
   */
  objects: defineTable(vObject)
    .index("object_id", ["object", "id"])
    .index("object_organization_id_id", ["object", "organization_id", "id"])
    .index("object_domain", ["object", "domain"])
    .index("object_directory_id_id", ["object", "directory_id", "id"])
    .index("object_organization_id_idp_id_id", [
      "object",
      "organization_id",
      "idp_id",
      "id",
    ])
    .index("object_idp_id_id", ["object", "idp_id", "id"])
    .index("object_email_id", ["object", "email", "id"]),

  /**
   * The pages `pull` fetched, decoded and staged, until `land` applies one.
   * `after` is the landed page it follows, null for the first. A page is
   * only ever inserted, by `stage`, and deleted, by `land`.
   */
  pages: defineTable({
    after: v.union(v.null(), v.id("pages")),
    /** Where the copy is once the page has landed. */
    position: vPosition,
    events: v.array(vWorkosEvent),
  }),

  /**
   * Where the copy is: the last page that landed, which the next page
   * follows. One row, which only `land` writes.
   */
  cursor: defineTable({ page: v.id("pages"), position: vPosition }),
});
