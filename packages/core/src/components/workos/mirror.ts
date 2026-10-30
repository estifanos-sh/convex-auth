/**
 * Writing updates, from webhook deliveries and from reconcile's listings,
 * into the copy, and telling the app about each change.
 *
 * @module
 */
import type { FunctionHandle } from "convex/server";
import { internal } from "./_generated/api.ts";
import type { Doc } from "./_generated/dataModel.ts";
import type { MutationCtx } from "./_generated/server.ts";
import type {
  WorkosConnection,
  WorkosDirectory,
  WorkosDirectoryChange,
  WorkosDirectoryGroup,
  WorkosDirectoryMember,
  WorkosDirectoryUser,
  WorkosDomain,
  WorkosOrganization,
} from "./schema.ts";
import { BATCH } from "./constants.ts";
import type { Kind, Update } from "./wire.ts";

/** The app's change handler, as the copy calls it. */
export type ChangeHandler = FunctionHandle<
  "mutation",
  { change: WorkosDirectoryChange },
  null
>;

/**
 * A stored handle as the {@link ChangeHandler} it is. Function handles are
 * strings that Convex brands, and a stored one loses the brand; Convex mints
 * them with this scheme.
 */
export function changeHandler(value: string): ChangeHandler {
  if (!isHandle(value)) throw new Error("onChange must be a function handle");
  return value;
}

function isHandle(value: string): value is ChangeHandler {
  return value.startsWith("function://");
}

export function organizationOf(row: Doc<"organizations">): WorkosOrganization {
  return { id: row.id, name: row.name, externalId: row.externalId };
}

export function domainOf(row: Doc<"domains">): WorkosDomain {
  return {
    id: row.id,
    organizationId: row.organizationId,
    domain: row.domain,
    state: row.state,
  };
}

export function connectionOf(row: Doc<"connections">): WorkosConnection {
  return {
    id: row.id,
    organizationId: row.organizationId,
    type: row.type,
    state: row.state,
  };
}

export function directoryOf(row: Doc<"directories">): WorkosDirectory {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    type: row.type,
    state: row.state,
  };
}

export function userOf(row: Doc<"directoryUsers">): WorkosDirectoryUser {
  return {
    id: row.id,
    directoryId: row.directoryId,
    organizationId: row.organizationId,
    idpId: row.idpId,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    state: row.state,
  };
}

export function groupOf(row: Doc<"directoryGroups">): WorkosDirectoryGroup {
  return {
    id: row.id,
    directoryId: row.directoryId,
    organizationId: row.organizationId,
    name: row.name,
  };
}

export function memberOf(row: Doc<"directoryMembers">): WorkosDirectoryMember {
  return {
    directoryId: row.directoryId,
    groupId: row.groupId,
    userId: row.userId,
  };
}

/** Whether two public shapes hold the same values. */
function same<T extends Record<string, string | undefined>>(a: T, b: T) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
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
    private readonly onChange: ChangeHandler | undefined,
  ) {}

  /** Tell the app about one change. */
  async emit(change: WorkosDirectoryChange): Promise<void> {
    if (this.onChange !== undefined) {
      await this.ctx.runMutation(this.onChange, { change });
    }
  }

  async write(update: Update): Promise<void> {
    switch (update.kind) {
      case "organization":
        return await this.organization(update.row, update.domains);
      case "domain":
        return await this.domain(update.row);
      case "connection":
        return await this.connection(update.row);
      case "directory":
        return await this.directory(update.row);
      case "user":
        return await this.user(update.row);
      case "group":
        return await this.group(update.row);
      case "member":
        return await this.member(update.row);
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
      case "domain": {
        const row = await db
          .query("domains")
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
        // Its users, groups and members can be many, so they go a page at a
        // time in `reconcile.sweep`, which removes the directory last.
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
      case "user": {
        const row = await db
          .query("directoryUsers")
          .withIndex("id", (q) => q.eq("id", id))
          .unique();
        if (row !== null) await this.removeUser(row);
        return;
      }
      case "group": {
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
    next: WorkosOrganization,
    domains: WorkosDomain[],
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
        kind: "organization",
        action: "upserted",
        organization: next,
      });
    }
    // The organization's list of domains is the whole set: a domain it no
    // longer lists is gone. An organization holds a handful.
    const listed = new Set(domains.map((domain) => domain.id));
    const held = await db
      .query("domains")
      .withIndex("organizationId", (q) => q.eq("organizationId", next.id))
      .collect();
    for (const domain of held) {
      if (!listed.has(domain.id)) await this.removeDomain(domain);
    }
    for (const domain of domains) await this.domain(domain);
  }

  private async domain(next: WorkosDomain) {
    const db = this.ctx.db;
    const row = await db
      .query("domains")
      .withIndex("id", (q) => q.eq("id", next.id))
      .unique();
    const fields = { ...next, generation: this.generation };
    if (row === null) await db.insert("domains", fields);
    else await db.replace("domains", row._id, fields);
    if (row === null || !same(domainOf(row), next)) {
      await this.emit({ kind: "domain", action: "upserted", domain: next });
    }
  }

  private async connection(next: WorkosConnection) {
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
        kind: "connection",
        action: "upserted",
        connection: next,
      });
    }
  }

  private async directory(next: WorkosDirectory) {
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
      await this.emit({
        kind: "directory",
        action: "upserted",
        directory: next,
      });
    }
  }

  private async user(next: WorkosDirectoryUser) {
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
        kind: "user",
        action: "upserted",
        user: next,
        deprovisioned: next.state !== "active",
      });
    }
  }

  private async group(next: WorkosDirectoryGroup) {
    const db = this.ctx.db;
    const row = await db
      .query("directoryGroups")
      .withIndex("id", (q) => q.eq("id", next.id))
      .unique();
    const fields = { ...next, generation: this.generation };
    if (row === null) await db.insert("directoryGroups", fields);
    else await db.replace("directoryGroups", row._id, fields);
    if (row === null || !same(groupOf(row), next)) {
      await this.emit({ kind: "group", action: "upserted", group: next });
    }
  }

  /**
   * A membership a listing of its group showed. Its time only moves forward,
   * so a listing that started earlier never makes it look older than a later
   * listing that also showed it.
   */
  private async member(next: WorkosDirectoryMember) {
    const db = this.ctx.db;
    const row = await db
      .query("directoryMembers")
      .withIndex("groupId_userId", (q) =>
        q.eq("groupId", next.groupId).eq("userId", next.userId),
      )
      .unique();
    if (row !== null) {
      if (row.generation < this.generation) {
        await db.patch("directoryMembers", row._id, {
          generation: this.generation,
        });
      }
      return;
    }
    await db.insert("directoryMembers", {
      ...next,
      generation: this.generation,
    });
    await this.emit({ kind: "member", action: "added", member: next });
  }

  async removeOrganization(row: Doc<"organizations">): Promise<void> {
    const domains = await this.ctx.db
      .query("domains")
      .withIndex("organizationId", (q) => q.eq("organizationId", row.id))
      .collect();
    for (const domain of domains) await this.removeDomain(domain);
    await this.ctx.db.delete("organizations", row._id);
    await this.emit({
      kind: "organization",
      action: "deleted",
      organization: organizationOf(row),
    });
  }

  async removeDomain(row: Doc<"domains">): Promise<void> {
    await this.ctx.db.delete("domains", row._id);
    await this.emit({
      kind: "domain",
      action: "deleted",
      domain: domainOf(row),
    });
  }

  async removeConnection(row: Doc<"connections">): Promise<void> {
    await this.ctx.db.delete("connections", row._id);
    await this.emit({
      kind: "connection",
      action: "deleted",
      connection: connectionOf(row),
    });
  }

  async removeDirectory(row: Doc<"directories">): Promise<void> {
    await this.ctx.db.delete("directories", row._id);
    await this.emit({
      kind: "directory",
      action: "deleted",
      directory: directoryOf(row),
    });
  }

  /**
   * Remove a directory user, after their memberships, which go a batch at a
   * time without a change of their own: the user's deletion says they ended.
   * A user with more than a batch keeps their row, freshly stamped so a
   * reconcile's removal passes over it, until `reconcile.drop` has removed
   * the rest.
   */
  async removeUser(row: Doc<"directoryUsers">): Promise<void> {
    const memberships = await this.ctx.db
      .query("directoryMembers")
      .withIndex("userId", (q) => q.eq("userId", row.id))
      .take(BATCH);
    for (const membership of memberships) {
      await this.ctx.db.delete("directoryMembers", membership._id);
    }
    if (memberships.length === BATCH) {
      await this.ctx.db.patch("directoryUsers", row._id, {
        generation: this.generation,
      });
      await this.ctx.scheduler.runAfter(0, internal.reconcile.drop, {
        kind: "user",
        id: row.id,
      });
      return;
    }
    await this.ctx.db.delete("directoryUsers", row._id);
    await this.emit({
      kind: "user",
      action: "deleted",
      user: userOf(row),
      deprovisioned: true,
    });
  }

  /** Remove a group after its memberships, as {@link removeUser} does. */
  async removeGroup(row: Doc<"directoryGroups">): Promise<void> {
    const memberships = await this.ctx.db
      .query("directoryMembers")
      .withIndex("groupId_userId", (q) => q.eq("groupId", row.id))
      .take(BATCH);
    for (const membership of memberships) {
      await this.ctx.db.delete("directoryMembers", membership._id);
    }
    if (memberships.length === BATCH) {
      await this.ctx.db.patch("directoryGroups", row._id, {
        generation: this.generation,
      });
      await this.ctx.scheduler.runAfter(0, internal.reconcile.drop, {
        kind: "group",
        id: row.id,
      });
      return;
    }
    await this.ctx.db.delete("directoryGroups", row._id);
    await this.emit({ kind: "group", action: "deleted", group: groupOf(row) });
  }

  async removeMember(row: Doc<"directoryMembers">): Promise<void> {
    await this.ctx.db.delete("directoryMembers", row._id);
    await this.emit({
      kind: "member",
      action: "removed",
      member: memberOf(row),
    });
  }
}
