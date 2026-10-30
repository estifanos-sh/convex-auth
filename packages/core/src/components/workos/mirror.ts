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
import type { Update } from "./wire.ts";

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

type StampedRow = { updatedAt: number; generation: number };

/**
 * What writing an object stamped `updatedAt` over `row` does. An older object
 * is passed over, so a late or repeated delivery never undoes what a later
 * listing or delivery wrote, though the row is still marked as seen.
 */
function decide<Row extends StampedRow>(
  row: Row | null,
  changed: (row: Row) => boolean,
  updatedAt: number,
): { op: "insert" } | { op: "replace"; row: Row } | { op: "touch"; row: Row } {
  if (row === null) return { op: "insert" };
  if (row.updatedAt > updatedAt || !changed(row)) return { op: "touch", row };
  return { op: "replace", row };
}

/**
 * The copy, inside one mutation. Every write stamps its row with
 * `generation`, the time it was written or the start of the reconcile that
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
        return await this.organization(update);
      case "domain":
        return await this.domain(update.row, update.deleted);
      case "connection":
        return await this.connection(update);
      case "directory":
        return await this.directory(update);
      case "user":
        return await this.user(update);
      case "group":
        return await this.group(update);
      case "member":
        return await this.member(update.row, update.deleted);
    }
  }

  private async organization(
    update: Extract<Update, { kind: "organization" }>,
  ) {
    const db = this.ctx.db;
    const row = await db
      .query("organizations")
      .withIndex("id", (q) => q.eq("id", update.row.id))
      .unique();
    const held = await db
      .query("domains")
      .withIndex("organizationId", (q) => q.eq("organizationId", update.row.id))
      .collect();
    if (update.deleted) {
      for (const domain of held) await this.removeDomain(domain);
      if (row !== null) await this.removeOrganization(row);
      return;
    }
    const decision = decide(
      row,
      (current) => !same(organizationOf(current), update.row),
      update.updatedAt,
    );
    const fields = {
      ...update.row,
      updatedAt: update.updatedAt,
      generation: this.generation,
    };
    if (decision.op === "touch") {
      await db.patch("organizations", decision.row._id, {
        generation: this.generation,
      });
      if (decision.row.updatedAt > update.updatedAt) return;
    } else {
      if (decision.op === "insert") await db.insert("organizations", fields);
      else await db.replace("organizations", decision.row._id, fields);
      await this.emit({
        kind: "organization",
        action: "upserted",
        organization: update.row,
      });
    }
    // The organization's list of domains is the whole set: a domain it no
    // longer lists is gone.
    const listed = new Set(update.domains.map((domain) => domain.id));
    for (const domain of held) {
      if (!listed.has(domain.id)) await this.removeDomain(domain);
    }
    for (const domain of update.domains) await this.domain(domain, false);
  }

  private async domain(next: WorkosDomain, deleted: boolean) {
    const db = this.ctx.db;
    const row = await db
      .query("domains")
      .withIndex("id", (q) => q.eq("id", next.id))
      .unique();
    if (deleted) {
      if (row !== null) await this.removeDomain(row);
      return;
    }
    const fields = { ...next, generation: this.generation };
    if (row !== null && same(domainOf(row), next)) {
      if (row.generation !== this.generation) {
        await db.patch("domains", row._id, { generation: this.generation });
      }
      return;
    }
    if (row === null) await db.insert("domains", fields);
    else await db.replace("domains", row._id, fields);
    await this.emit({ kind: "domain", action: "upserted", domain: next });
  }

  private async connection(update: Extract<Update, { kind: "connection" }>) {
    const db = this.ctx.db;
    const row = await db
      .query("connections")
      .withIndex("id", (q) => q.eq("id", update.row.id))
      .unique();
    if (update.deleted) {
      if (row !== null) await this.removeConnection(row);
      return;
    }
    const decision = decide(
      row,
      (current) => !same(connectionOf(current), update.row),
      update.updatedAt,
    );
    const fields = {
      ...update.row,
      updatedAt: update.updatedAt,
      generation: this.generation,
    };
    if (decision.op === "touch") {
      await db.patch("connections", decision.row._id, {
        generation: this.generation,
      });
      return;
    }
    if (decision.op === "insert") await db.insert("connections", fields);
    else await db.replace("connections", decision.row._id, fields);
    await this.emit({
      kind: "connection",
      action: "upserted",
      connection: update.row,
    });
  }

  private async directory(update: Extract<Update, { kind: "directory" }>) {
    const db = this.ctx.db;
    const row = await db
      .query("directories")
      .withIndex("id", (q) => q.eq("id", update.row.id))
      .unique();
    if (update.deleted) {
      // Its users, groups and members can be many, so they go a page at a
      // time in `reconcile.sweep`, which removes the directory last.
      if (row !== null && row.deleted !== true) {
        await db.patch("directories", row._id, { deleted: true });
        await this.ctx.scheduler.runAfter(0, internal.reconcile.sweep, {});
      }
      return;
    }
    if (row?.deleted === true) return;
    const decision = decide(
      row,
      (current) => !same(directoryOf(current), update.row),
      update.updatedAt,
    );
    const fields = {
      ...update.row,
      updatedAt: update.updatedAt,
      generation: this.generation,
    };
    if (decision.op === "touch") {
      await db.patch("directories", decision.row._id, {
        generation: this.generation,
      });
      return;
    }
    if (decision.op === "insert") await db.insert("directories", fields);
    else await db.replace("directories", decision.row._id, fields);
    await this.emit({
      kind: "directory",
      action: "upserted",
      directory: update.row,
    });
  }

  private async user(update: Extract<Update, { kind: "user" }>) {
    const db = this.ctx.db;
    const row = await db
      .query("directoryUsers")
      .withIndex("id", (q) => q.eq("id", update.row.id))
      .unique();
    if (update.deleted) {
      if (row !== null) await this.removeUser(row);
      return;
    }
    const decision = decide(
      row,
      (current) => !same(userOf(current), update.row),
      update.updatedAt,
    );
    const fields = {
      ...update.row,
      updatedAt: update.updatedAt,
      generation: this.generation,
    };
    if (decision.op === "touch") {
      await db.patch("directoryUsers", decision.row._id, {
        generation: this.generation,
      });
      return;
    }
    if (decision.op === "insert") await db.insert("directoryUsers", fields);
    else await db.replace("directoryUsers", decision.row._id, fields);
    await this.emit({
      kind: "user",
      action: "upserted",
      user: update.row,
      deprovisioned: update.row.state !== "active",
    });
  }

  private async group(update: Extract<Update, { kind: "group" }>) {
    const db = this.ctx.db;
    const row = await db
      .query("directoryGroups")
      .withIndex("id", (q) => q.eq("id", update.row.id))
      .unique();
    if (update.deleted) {
      if (row !== null) await this.removeGroup(row);
      return;
    }
    const decision = decide(
      row,
      (current) => !same(groupOf(current), update.row),
      update.updatedAt,
    );
    const fields = {
      ...update.row,
      updatedAt: update.updatedAt,
      generation: this.generation,
    };
    if (decision.op === "touch") {
      await db.patch("directoryGroups", decision.row._id, {
        generation: this.generation,
      });
      return;
    }
    if (decision.op === "insert") await db.insert("directoryGroups", fields);
    else await db.replace("directoryGroups", decision.row._id, fields);
    await this.emit({ kind: "group", action: "upserted", group: update.row });
  }

  private async member(next: WorkosDirectoryMember, removed: boolean) {
    const db = this.ctx.db;
    const row = await db
      .query("directoryMembers")
      .withIndex("groupId_userId", (q) =>
        q.eq("groupId", next.groupId).eq("userId", next.userId),
      )
      .unique();
    if (removed) {
      if (row !== null) await this.removeMember(row);
      return;
    }
    if (row !== null) {
      if (row.generation !== this.generation) {
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
   * Remove a directory user and their memberships. The memberships go
   * without a change of their own: the user's deletion says they ended.
   */
  async removeUser(row: Doc<"directoryUsers">): Promise<void> {
    const memberships = await this.ctx.db
      .query("directoryMembers")
      .withIndex("userId", (q) => q.eq("userId", row.id))
      .collect();
    for (const membership of memberships) {
      await this.ctx.db.delete("directoryMembers", membership._id);
    }
    await this.ctx.db.delete("directoryUsers", row._id);
    await this.emit({
      kind: "user",
      action: "deleted",
      user: userOf(row),
      deprovisioned: true,
    });
  }

  /** Remove a group and, without changes of their own, its memberships. */
  async removeGroup(row: Doc<"directoryGroups">): Promise<void> {
    const memberships = await this.ctx.db
      .query("directoryMembers")
      .withIndex("groupId_userId", (q) => q.eq("groupId", row.id))
      .collect();
    for (const membership of memberships) {
      await this.ctx.db.delete("directoryMembers", membership._id);
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
