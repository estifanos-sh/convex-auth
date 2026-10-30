/**
 * Writing updates, from webhook deliveries and from reconcile's listings,
 * into the copy, and telling the app about each change as the WorkOS event
 * it is.
 *
 * @module
 */
import type { FunctionHandle } from "convex/server";
import { internal } from "./_generated/api.ts";
import type { Doc } from "./_generated/dataModel.ts";
import type { MutationCtx } from "./_generated/server.ts";
import type {
  Connection,
  Directory,
  DirectoryGroup,
  DirectoryUser,
  Organization,
  OrganizationDomain,
  WorkosEvent,
} from "./schema.ts";
import type { Kind, Update } from "./wire.ts";

/** The app's event handler, as the copy calls it. */
export type EventHandler = FunctionHandle<
  "mutation",
  { event: WorkosEvent },
  null
>;

/**
 * A stored handle as the {@link EventHandler} it is. Function handles are
 * strings that Convex brands, and a stored one loses the brand; Convex mints
 * them with this scheme.
 */
export function eventHandler(value: string): EventHandler {
  if (!isHandle(value)) throw new Error("onEvent must be a function handle");
  return value;
}

function isHandle(value: string): value is EventHandler {
  return value.startsWith("function://");
}

export function organizationOf({
  id,
  name,
  externalId,
}: Doc<"organizations">): Organization {
  return { id, name, externalId };
}

export function domainOf({
  id,
  organizationId,
  domain,
  state,
}: Doc<"organizationDomains">): OrganizationDomain {
  return { id, organizationId, domain, state };
}

export function connectionOf({
  id,
  organizationId,
  connectionType,
  name,
  state,
}: Doc<"connections">): Connection {
  return { id, organizationId, connectionType, name, state };
}

export function directoryOf({
  id,
  organizationId,
  name,
  type,
  state,
}: Doc<"directories">): Directory {
  return { id, organizationId, name, type, state };
}

export function userOf({
  id,
  directoryId,
  organizationId,
  idpId,
  email,
  firstName,
  lastName,
  state,
  role,
  roles,
}: Doc<"directoryUsers">): DirectoryUser {
  return {
    id,
    directoryId,
    organizationId,
    idpId,
    email,
    firstName,
    lastName,
    state,
    role,
    roles,
  };
}

export function groupOf({
  id,
  directoryId,
  organizationId,
  idpId,
  name,
}: Doc<"directoryGroups">): DirectoryGroup {
  return { id, directoryId, organizationId, idpId, name };
}

/**
 * One page of rows read in `id` order, from after the cursor, which is the
 * last id of the page before. Components cannot use Convex's `paginate`.
 */
export async function pageOf<Row extends { id: string }, Item>(
  rows: { take(n: number): Promise<Row[]> },
  numItems: number,
  convert: (row: Row) => Item,
) {
  const taken = await rows.take(numItems + 1);
  const page = taken.slice(0, numItems);
  return {
    page: page.map(convert),
    isDone: taken.length <= numItems,
    continueCursor: page.at(-1)?.id ?? "",
  };
}

/** Whether two values hold the same JSON, whatever their keys' order. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => same(item, b[i]));
  }
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null ||
    Array.isArray(a) ||
    Array.isArray(b)
  ) {
    return false;
  }
  const left = Object.entries(a).filter(([, value]) => value !== undefined);
  const right = new Map(
    Object.entries(b).filter(([, value]) => value !== undefined),
  );
  return (
    left.length === right.size &&
    left.every(([key, value]) => same(value, right.get(key)))
  );
}

/**
 * The copy, inside one mutation. Every write stamps its row with
 * `generation`, the time it was read or the start of the reconcile that
 * listed it, and every change runs the app's handler in the same transaction,
 * so the copy and the app never disagree.
 */
export class Mirror {
  constructor(
    private readonly ctx: MutationCtx,
    private readonly generation: number,
    private readonly onEvent: EventHandler,
  ) {}

  /** Tell the app about one change. */
  async emit(event: WorkosEvent): Promise<void> {
    await this.ctx.runMutation(this.onEvent, { event });
  }

  async write(update: Update): Promise<void> {
    switch (update.kind) {
      case "organization":
        return await this.organization(update.row, update.domains);
      case "organizationDomain":
        return await this.domain(update.row);
      case "connection":
        return await this.connection(update.row);
      case "directory":
        return await this.directory(update.row);
      case "directoryUser":
        return await this.user(update.row);
      case "directoryGroup":
        return await this.group(update.row);
    }
  }

  /** Remove an object WorkOS no longer has, if the copy holds it. */
  async remove(kind: Kind, id: string): Promise<void> {
    const db = this.ctx.db;
    switch (kind) {
      case "organization": {
        const row = await db
          .query("organizations")
          .withIndex("id", (q) => q.eq("id", id))
          .unique();
        if (row !== null) await this.removeOrganization(row);
        return;
      }
      case "organizationDomain": {
        const row = await db
          .query("organizationDomains")
          .withIndex("id", (q) => q.eq("id", id))
          .unique();
        if (row !== null) await this.removeDomain(row);
        return;
      }
      case "connection": {
        const row = await db
          .query("connections")
          .withIndex("id", (q) => q.eq("id", id))
          .unique();
        if (row !== null) await this.removeConnection(row);
        return;
      }
      case "directory": {
        // Its users and groups can be many, so they go a batch at a time in
        // `reconcile.sweep`, which removes the directory last.
        const row = await db
          .query("directories")
          .withIndex("id", (q) => q.eq("id", id))
          .unique();
        if (row === null) return;
        await db.patch("directories", row._id, {
          deleted: true,
          generation: this.generation,
        });
        if (row.deleted !== true) {
          await this.ctx.scheduler.runAfter(0, internal.reconcile.sweep, {});
        }
        return;
      }
      case "directoryUser": {
        const row = await db
          .query("directoryUsers")
          .withIndex("id", (q) => q.eq("id", id))
          .unique();
        if (row !== null) await this.removeUser(row);
        return;
      }
      case "directoryGroup": {
        const row = await db
          .query("directoryGroups")
          .withIndex("id", (q) => q.eq("id", id))
          .unique();
        if (row !== null) await this.removeGroup(row);
        return;
      }
    }
  }

  private async organization(
    next: Organization,
    domains: OrganizationDomain[],
  ) {
    const db = this.ctx.db;
    const row = await db
      .query("organizations")
      .withIndex("id", (q) => q.eq("id", next.id))
      .unique();
    const fields = { ...next, generation: this.generation };
    if (row === null) await db.insert("organizations", fields);
    else await db.replace("organizations", row._id, fields);
    if (row === null || !same(organizationOf(row), next)) {
      await this.emit({
        event: row === null ? "organization.created" : "organization.updated",
        data: next,
      });
    }
    // The organization's list of domains is the whole set: a domain it no
    // longer lists is gone. An organization holds a handful.
    const listed = new Set(domains.map((domain) => domain.id));
    const held = await db
      .query("organizationDomains")
      .withIndex("organizationId", (q) => q.eq("organizationId", next.id))
      .collect();
    for (const domain of held) {
      if (!listed.has(domain.id)) await this.removeDomain(domain);
    }
    for (const domain of domains) await this.domain(domain);
  }

  private async domain(next: OrganizationDomain) {
    const db = this.ctx.db;
    const row = await db
      .query("organizationDomains")
      .withIndex("id", (q) => q.eq("id", next.id))
      .unique();
    const fields = { ...next, generation: this.generation };
    if (row === null) await db.insert("organizationDomains", fields);
    else await db.replace("organizationDomains", row._id, fields);
    if (row === null || !same(domainOf(row), next)) {
      await this.emit({
        event:
          row === null
            ? "organization_domain.created"
            : "organization_domain.updated",
        data: next,
      });
    }
  }

  private async connection(next: Connection) {
    const db = this.ctx.db;
    const row = await db
      .query("connections")
      .withIndex("id", (q) => q.eq("id", next.id))
      .unique();
    const fields = { ...next, generation: this.generation };
    if (row === null) await db.insert("connections", fields);
    else await db.replace("connections", row._id, fields);
    if (row === null || !same(connectionOf(row), next)) {
      await this.emit({
        event:
          next.state === "active"
            ? "connection.activated"
            : "connection.deactivated",
        data: next,
      });
    }
  }

  private async directory(next: Directory) {
    const db = this.ctx.db;
    const row = await db
      .query("directories")
      .withIndex("id", (q) => q.eq("id", next.id))
      .unique();
    if (row?.deleted === true) return;
    const fields = { ...next, generation: this.generation };
    if (row === null) await db.insert("directories", fields);
    else await db.replace("directories", row._id, fields);
    if (row === null || !same(directoryOf(row), next)) {
      await this.emit({ event: "dsync.activated", data: next });
    }
  }

  private async user(next: DirectoryUser) {
    const db = this.ctx.db;
    const row = await db
      .query("directoryUsers")
      .withIndex("id", (q) => q.eq("id", next.id))
      .unique();
    const fields = { ...next, generation: this.generation };
    if (row === null) await db.insert("directoryUsers", fields);
    else await db.replace("directoryUsers", row._id, fields);
    if (row === null || !same(userOf(row), next)) {
      await this.emit({
        event: row === null ? "dsync.user.created" : "dsync.user.updated",
        data: next,
      });
    }
  }

  private async group(next: DirectoryGroup) {
    const db = this.ctx.db;
    const row = await db
      .query("directoryGroups")
      .withIndex("id", (q) => q.eq("id", next.id))
      .unique();
    const fields = { ...next, generation: this.generation };
    if (row === null) await db.insert("directoryGroups", fields);
    else await db.replace("directoryGroups", row._id, fields);
    if (row === null || !same(groupOf(row), next)) {
      await this.emit({
        event: row === null ? "dsync.group.created" : "dsync.group.updated",
        data: next,
      });
    }
  }

  async removeOrganization(row: Doc<"organizations">): Promise<void> {
    const domains = await this.ctx.db
      .query("organizationDomains")
      .withIndex("organizationId", (q) => q.eq("organizationId", row.id))
      .collect();
    for (const domain of domains) await this.removeDomain(domain);
    await this.ctx.db.delete("organizations", row._id);
    await this.emit({
      event: "organization.deleted",
      data: organizationOf(row),
    });
  }

  async removeDomain(row: Doc<"organizationDomains">): Promise<void> {
    await this.ctx.db.delete("organizationDomains", row._id);
    await this.emit({
      event: "organization_domain.deleted",
      data: domainOf(row),
    });
  }

  async removeConnection(row: Doc<"connections">): Promise<void> {
    await this.ctx.db.delete("connections", row._id);
    await this.emit({ event: "connection.deleted", data: connectionOf(row) });
  }

  async removeDirectory(row: Doc<"directories">): Promise<void> {
    await this.ctx.db.delete("directories", row._id);
    await this.emit({ event: "dsync.deleted", data: directoryOf(row) });
  }

  async removeUser(row: Doc<"directoryUsers">): Promise<void> {
    await this.ctx.db.delete("directoryUsers", row._id);
    await this.emit({ event: "dsync.user.deleted", data: userOf(row) });
  }

  async removeGroup(row: Doc<"directoryGroups">): Promise<void> {
    await this.ctx.db.delete("directoryGroups", row._id);
    await this.emit({ event: "dsync.group.deleted", data: groupOf(row) });
  }
}
