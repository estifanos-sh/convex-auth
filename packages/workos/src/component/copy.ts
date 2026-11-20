/**
 * The copy of the WorkOS environment: its organizations, their domains, the
 * SSO connections, the directories, and their users and groups, in one table
 * tagged by WorkOS's `object`. `land` is its one writer, and applies a page
 * of events in WorkOS's order, so a later event always wins and nothing is
 * read again from WorkOS.
 *
 * @module
 */
import type { Doc } from "./_generated/dataModel.ts";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server.ts";
import type {
  OrganizationDomain,
  WorkosEvent,
  WorkosObject,
} from "./validators.ts";

type Kind = WorkosObject["object"];

/** The objects of one kind. */
export type Of<K extends Kind> = Extract<WorkosObject, { object: K }>;

/** A row as its validator describes it, without the system fields. */
export function bare({
  _id,
  _creationTime,
  ...object
}: Doc<"objects">): WorkosObject {
  return object;
}

function is<K extends Kind>(object: WorkosObject, kind: K): object is Of<K> {
  return object.object === kind;
}

/** The rows of `kind` among `rows`, as their validator describes them. */
export function only<K extends Kind>(kind: K, rows: Doc<"objects">[]): Of<K>[] {
  return rows.map(bare).filter((object) => is(object, kind));
}

/**
 * One page of rows read in `id` order, from after the cursor, which is the
 * last id of the page before. Components cannot use Convex's `paginate`.
 */
export async function pageOf<K extends Kind>(
  kind: K,
  rows: { take(n: number): Promise<Doc<"objects">[]> },
  numItems: number,
) {
  const taken = await rows.take(numItems + 1);
  const page = taken.slice(0, numItems);
  return {
    page: only(kind, page),
    isDone: taken.length <= numItems,
    continueCursor: page.at(-1)?.id ?? "",
  };
}

async function held(db: DatabaseReader, kind: Kind, id: string) {
  return await db
    .query("objects")
    .withIndex("object_id", (q) => q.eq("object", kind).eq("id", id))
    .unique();
}

/** The object of `kind` with WorkOS's `id`, or null. */
export async function find<K extends Kind>(
  db: DatabaseReader,
  kind: K,
  id: string,
): Promise<Of<K> | null> {
  const row = await held(db, kind, id);
  return only(kind, row === null ? [] : [row])[0] ?? null;
}

/** The objects of `kind` of one organization. */
export async function owned<K extends Kind>(
  db: DatabaseReader,
  kind: K,
  organizationId: string,
): Promise<Of<K>[]> {
  const rows = await db
    .query("objects")
    .withIndex("object_organization_id_id", (q) =>
      q.eq("object", kind).eq("organization_id", organizationId),
    )
    .collect();
  return only(kind, rows);
}

export class Copy {
  constructor(private readonly db: DatabaseWriter) {}

  /**
   * Apply one event, and return the changes it made, as events: the event
   * itself, and for a deleted directory the deletion of each of its users and
   * groups, which WorkOS sends no event for.
   */
  async apply(event: WorkosEvent): Promise<WorkosEvent[]> {
    switch (event.event) {
      case "organization.created":
      case "organization.updated": {
        const { domains, ...organization } = event.data;
        await this.put(organization);
        await this.own(organization.id, domains);
        return [event];
      }
      case "organization.deleted":
        await this.remove("organization", event.data.id);
        await this.own(event.data.id, []);
        return [event];
      case "organization_domain.created":
      case "organization_domain.updated":
      case "organization_domain.verified":
        await this.put(event.data);
        return [event];
      case "organization_domain.verification_failed":
        await this.put(event.data.organization_domain);
        return [event];
      case "organization_domain.deleted":
        await this.remove("organization_domain", event.data.id);
        return [event];
      case "connection.activated":
      case "connection.deactivated":
        await this.put(event.data);
        return [event];
      case "connection.deleted":
        await this.remove("connection", event.data.id);
        return [event];
      case "dsync.activated":
        await this.put(event.data);
        return [event];
      case "dsync.deleted":
        await this.remove("directory", event.data.id);
        return [event, ...(await this.empty(event.data.id))];
      case "dsync.user.created":
      case "dsync.user.updated":
      case "dsync.group.created":
      case "dsync.group.updated":
        await this.put(event.data);
        return [event];
      case "dsync.user.deleted":
        await this.remove("directory_user", event.data.id);
        return [event];
      case "dsync.group.deleted":
        await this.remove("directory_group", event.data.id);
        return [event];
      case "dsync.group.user_added":
      case "dsync.group.user_removed":
        // WorkOS keeps no membership object: a membership moves the roles
        // of the directory user, which the event carries as it is now.
        await this.put(event.data.user);
        return [event];
    }
  }

  /** Write an object as WorkOS holds it, with its domain or email lowercased. */
  private async put(object: WorkosObject): Promise<void> {
    const row = normal(object);
    const existing = await held(this.db, row.object, row.id);
    if (existing === null) await this.db.insert("objects", row);
    else await this.db.replace("objects", existing._id, row);
  }

  private async remove(kind: Kind, id: string): Promise<void> {
    const existing = await held(this.db, kind, id);
    if (existing !== null) await this.db.delete("objects", existing._id);
  }

  /**
   * Make the organization's domains the ones it lists. A listed domain that
   * names no state keeps the one the copy holds.
   */
  private async own(
    organizationId: string,
    listed: {
      id: string;
      domain: string;
      state?: OrganizationDomain["state"];
    }[],
  ): Promise<void> {
    const kept = new Map(
      (await owned(this.db, "organization_domain", organizationId)).map(
        (domain) => [domain.id, domain],
      ),
    );
    for (const { id, domain, state } of listed) {
      const before = kept.get(id);
      kept.delete(id);
      await this.put({
        object: "organization_domain",
        id,
        organization_id: organizationId,
        domain,
        state: state ?? before?.state ?? "pending",
      });
    }
    for (const domain of kept.values()) {
      await this.remove("organization_domain", domain.id);
    }
  }

  /** Remove a deleted directory's users and groups. */
  private async empty(directoryId: string): Promise<WorkosEvent[]> {
    const removed: WorkosEvent[] = [];
    for (const kind of ["directory_user", "directory_group"] as const) {
      const rows = await this.db
        .query("objects")
        .withIndex("object_directory_id_id", (q) =>
          q.eq("object", kind).eq("directory_id", directoryId),
        )
        .collect();
      for (const row of rows) {
        await this.db.delete("objects", row._id);
        const data = bare(row);
        if (is(data, "directory_user")) {
          removed.push({ event: "dsync.user.deleted", data });
        } else if (is(data, "directory_group")) {
          removed.push({ event: "dsync.group.deleted", data });
        }
      }
    }
    return removed;
  }
}

/** What the copy's indexes read: a lowercased domain, a lowercased email. */
function normal(object: WorkosObject): WorkosObject {
  switch (object.object) {
    case "organization_domain":
      return { ...object, domain: object.domain.toLowerCase() };
    case "directory_user":
      return object.email === undefined
        ? object
        : { ...object, email: object.email.toLowerCase() };
    default:
      return object;
  }
}
