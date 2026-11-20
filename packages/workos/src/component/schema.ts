import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  accountsTable,
  authorizationRequestsTable,
  ticketsTable,
} from "@convex-dev/auth/lib/oauth/schema";
import { vPosition } from "./fill.ts";
import { vObject, vWorkosEvent } from "./validators.ts";

/**
 * A page of events `pull` fetched, decoded and staged, until `land` applies
 * it. `after` is the landed page it follows, null for the first page. The
 * landed page is the copy's cursor: there is one, and the next page follows
 * it.
 */
const page = {
  after: v.union(v.null(), v.id("pages")),
  /** Where the copy is once the page has landed. */
  position: vPosition,
};

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

  pages: defineTable(
    v.union(
      v.object({
        state: v.literal("staged"),
        ...page,
        events: v.array(vWorkosEvent),
      }),
      v.object({ state: v.literal("landed"), ...page }),
    ),
  ).index("state_after", ["state", "after"]),
});
