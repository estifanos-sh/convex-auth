/**
 * Backfills: the listings that fill the copy and reconcile it against WorkOS.
 *
 * A backfill lists one scope's objects page by page, marking every row it
 * sees, then reconciles: whatever it did not see, and nothing has touched
 * since it began, is gone at WorkOS and gets a tombstone.
 *
 * @module
 */
import { v } from "convex/values";
import { Api } from "./workosApi.ts";
import { Mirror, Queue, type Table } from "./mirror.ts";
import { type ChangeKind, type Update, vHandles, vUpdate } from "./changes.ts";
import { recover, thrown } from "./faults.ts";
import schema, { type BackfillScope } from "./schema.ts";
import { PAGE_SIZE } from "./lane.ts";
import { Credentials } from "./credentials.ts";
import { decodeItem, decodeList, type Endpoint } from "./wire.ts";
import { internal } from "./_generated/api.ts";
import type { Doc, Id } from "./_generated/dataModel.ts";
import type { MutationCtx } from "./_generated/server.ts";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server.ts";

const LISTS: Record<BackfillScope, readonly Endpoint[]> = {
  organizations: ["organizations"],
  users: ["users"],
  organization: ["memberships", "connections", "directories"],
  directory: ["directoryUsers", "directoryGroups"],
  group: ["groupMembers"],
  user: [],
};

const RECONCILES: Record<BackfillScope, number> = {
  organizations: 8,
  users: 1,
  organization: 7,
  directory: 3,
  group: 1,
  user: 1,
};

function request(
  endpoint: Endpoint,
  target: string,
): [string, Record<string, string | string[]>] {
  switch (endpoint) {
    case "organizations":
      return ["/organizations", {}];
    case "users":
      return ["/user_management/users", {}];
    case "memberships":
      return [
        "/user_management/organization_memberships",
        {
          organization_id: target,
          "statuses[]": ["active", "inactive", "pending"],
        },
      ];
    case "connections":
      return ["/connections", { organization_id: target }];
    case "directories":
      return ["/directories", { organization_id: target }];
    case "directoryUsers":
      return ["/directory_users", { directory: target }];
    case "directoryGroups":
      return ["/directory_groups", { directory: target }];
    case "groupMembers":
      return ["/directory_users", { group: target }];
  }
}

const Row = schema.tables.backfills.validator.extend({
  _id: v.id("backfills"),
});

export const get = internalQuery({
  args: { id: v.id("backfills") },
  returns: v.union(v.null(), Row),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("backfills", args.id);
    if (row === null) return null;
    const { _creationTime, ...rest } = row;
    return rest;
  },
});

function advance(
  row: Doc<"backfills">,
  next: string | null,
): Partial<Doc<"backfills">> {
  const steps =
    row.phase === "list" ? LISTS[row.scope].length : RECONCILES[row.scope];
  if (next !== null) return { after: next };
  if (row.step + 1 < steps) return { step: row.step + 1, after: undefined };
  return {
    phase: row.phase === "list" ? "reconcile" : "done",
    step: 0,
    after: undefined,
  };
}

// A step that moved its row on enqueues the row's next page itself; a finished row, or one that
// opened others, hands the free lane slots to the rows waiting behind it.
async function proceed(
  ctx: MutationCtx,
  queue: Queue,
  row: Doc<"backfills">,
  next: string | null,
) {
  const fields = advance(row, next);
  const done = fields.phase === "done";
  const work = done ? undefined : await queue.enqueue(row._id);
  await ctx.db.patch("backfills", row._id, { ...fields, work });
  if (done || queue.opened) await queue.drive();
}

async function current(
  ctx: MutationCtx,
  id: Id<"backfills">,
  phase: "list" | "reconcile",
  step: number,
  after: string | null,
): Promise<Doc<"backfills"> | null> {
  const row = await ctx.db.get("backfills", id);
  if (
    row === null ||
    row.phase !== phase ||
    row.step !== step ||
    (row.after ?? null) !== after
  ) {
    return null;
  }
  return row;
}

// Listing marks every row it sees with the backfill's id; the parent organizations listing hands
// each organization's domains the id of that organization's own backfill, whose reconcile owns them.
export const list = internalMutation({
  args: {
    id: v.id("backfills"),
    step: v.number(),
    after: v.union(v.string(), v.null()),
    items: v.array(vUpdate),
    next: v.union(v.string(), v.null()),
    at: v.number(),
    handles: vHandles,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await current(ctx, args.id, "list", args.step, args.after);
    if (row === null) return false;
    const mirror = new Mirror(ctx, args.handles);
    for (const item of args.items) {
      try {
        if (item.kind === "organization" && row.scope === "organizations") {
          const child = await mirror.backfills.open(
            "organization",
            item.row.workosId,
            "list",
            args.at,
          );
          await mirror.write(item, row._id, child);
        } else {
          await mirror.write(item, row._id);
        }
        if (item.kind === "directory" && !item.row.deleted) {
          await mirror.backfills.open(
            "directory",
            item.row.workosId,
            "list",
            args.at,
          );
        }
        if (item.kind === "directoryGroup" && !item.row.deleted) {
          await mirror.backfills.open(
            "group",
            item.row.workosId,
            "list",
            args.at,
          );
        }
      } catch (error) {
        throw thrown(error);
      }
    }
    await proceed(ctx, mirror.backfills, row, args.next);
    return true;
  },
});

type Mirrored = Doc<Table>;

type Scanned = {
  table: Table;
  kind: ChangeKind | null;
  cascade?: BackfillScope;
  page: Mirrored[];
  isDone: boolean;
  continueCursor: string;
};

type Paged = { page: Mirrored[]; isDone: boolean; continueCursor: string };

function scanned(
  table: Table,
  kind: ChangeKind | null,
  result: Paged,
  cascade?: BackfillScope,
): Scanned {
  return {
    table,
    kind,
    cascade,
    page: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

async function scan(
  ctx: MutationCtx,
  row: Doc<"backfills">,
  cursor: string | null,
): Promise<Scanned> {
  const options = { numItems: PAGE_SIZE, cursor };
  const target = row.target ?? "";
  switch (`${row.scope}:${String(row.step)}`) {
    case "organizations:0":
      return scanned(
        "organizations",
        "organization",
        await ctx.db
          .query("organizations")
          .withIndex("by_workosId")
          .paginate(options),
        "organization",
      );
    case "users:0":
      return scanned(
        "users",
        "user",
        await ctx.db.query("users").withIndex("by_workosId").paginate(options),
      );
    case "organization:0":
      return scanned(
        "memberships",
        "membership",
        await ctx.db
          .query("memberships")
          .withIndex("by_organization", (q) => q.eq("organization", target))
          .paginate(options),
      );
    case "organization:1":
      return scanned(
        "domains",
        null,
        await ctx.db
          .query("domains")
          .withIndex("by_organization", (q) => q.eq("organization", target))
          .paginate(options),
      );
    case "organization:2":
      return scanned(
        "connections",
        "connection",
        await ctx.db
          .query("connections")
          .withIndex("by_organization", (q) => q.eq("organization", target))
          .paginate(options),
      );
    case "organization:3":
      return scanned(
        "directories",
        "directory",
        await ctx.db
          .query("directories")
          .withIndex("by_organization", (q) => q.eq("organization", target))
          .paginate(options),
        "directory",
      );
    case "organization:4":
      return scanned(
        "directoryUsers",
        "directoryUser",
        await ctx.db
          .query("directoryUsers")
          .withIndex("by_organization", (q) => q.eq("organization", target))
          .paginate(options),
        "user",
      );
    case "organization:5":
      return scanned(
        "directoryGroups",
        "directoryGroup",
        await ctx.db
          .query("directoryGroups")
          .withIndex("by_organization", (q) => q.eq("organization", target))
          .paginate(options),
        "group",
      );
    case "organization:6":
      return scanned(
        "directoryMembers",
        "directoryMember",
        await ctx.db
          .query("directoryMembers")
          .withIndex("by_organization", (q) => q.eq("organization", target))
          .paginate(options),
      );
    case "directory:0":
      return scanned(
        "directoryUsers",
        "directoryUser",
        await ctx.db
          .query("directoryUsers")
          .withIndex("by_directory", (q) => q.eq("directory", target))
          .paginate(options),
        "user",
      );
    case "directory:1":
      return scanned(
        "directoryGroups",
        "directoryGroup",
        await ctx.db
          .query("directoryGroups")
          .withIndex("by_directory", (q) => q.eq("directory", target))
          .paginate(options),
        "group",
      );
    case "directory:2":
      return scanned(
        "directoryMembers",
        "directoryMember",
        await ctx.db
          .query("directoryMembers")
          .withIndex("by_directory", (q) => q.eq("directory", target))
          .paginate(options),
      );
    case "group:0":
      return scanned(
        "directoryMembers",
        "directoryMember",
        await ctx.db
          .query("directoryMembers")
          .withIndex("by_group_user", (q) => q.eq("group", target))
          .paginate(options),
      );
    case "user:0":
      return scanned(
        "directoryMembers",
        "directoryMember",
        await ctx.db
          .query("directoryMembers")
          .withIndex("by_user", (q) => q.eq("user", target))
          .paginate(options),
      );
    default:
      return {
        table: "organizations",
        kind: null,
        page: [],
        isDone: true,
        continueCursor: "",
      };
  }
}

async function live(
  ctx: MutationCtx,
  table: "organizations" | "directories" | "directoryUsers" | "directoryGroups",
  id: string | undefined,
): Promise<boolean> {
  if (id === undefined) return false;
  const query = ctx.db.query(table);
  const row = await query
    .withIndex("by_workosId", (q) => q.eq("workosId", id))
    .unique();
  return row !== null && !row.deleted;
}

// Directory users, groups and their edges belong to their own listings. A live parent's reconcile
// reaches only the orphans among them: rows whose own parent the mirror does not hold, which the
// stream can deliver before any snapshot held that parent and whose parent can then go without a
// trace. A deleted parent's reconcile reaches them all.
async function orphaned(ctx: MutationCtx, doc: Mirrored): Promise<boolean> {
  if ("group" in doc) {
    return (
      !(await live(ctx, "directoryGroups", doc.group)) ||
      !(await live(ctx, "directoryUsers", doc.user))
    );
  }
  return "directory" in doc && !(await live(ctx, "directories", doc.directory));
}

async function page(
  ctx: MutationCtx,
  row: Doc<"backfills">,
  cursor: string | null,
): Promise<Scanned> {
  const result = await scan(ctx, row, cursor);
  const parent =
    row.scope === "organization" && row.step >= 4
      ? await live(ctx, "organizations", row.target)
      : row.scope === "directory" && row.step >= 2
        ? await live(ctx, "directories", row.target)
        : null;
  if (parent !== true) return result;
  const kept: Mirrored[] = [];
  for (const doc of result.page) if (await orphaned(ctx, doc)) kept.push(doc);
  return { ...result, page: kept };
}

const CHILDREN = [
  "memberships",
  "domains",
  "connections",
  "directories",
  "directoryUsers",
  "directoryGroups",
  "directoryMembers",
] as const;

// An organization the mirror never held leaves no tombstone for a cascade to start from, yet one
// deleted while the cursor was expired can still own rows the stream delivered. The full reconcile
// visits each distinct organization a child table names, one index seek apiece rather than a read
// per row, and opens the cascade for any the mirror holds no row of.
async function strays(
  ctx: MutationCtx,
  queue: Queue,
  row: Doc<"backfills">,
  after: string | null,
): Promise<string | null> {
  const table = CHILDREN[row.step - 1];
  if (table === undefined) return null;
  let last = after ?? "";
  for (let visited = 0; visited < PAGE_SIZE; visited += 1) {
    const next = await ctx.db
      .query(table)
      .withIndex("by_organization", (q) => q.gt("organization", last))
      .first();
    const organization = next?.organization;
    if (organization === undefined) return null;
    last = organization;
    const held = await ctx.db
      .query("organizations")
      .withIndex("by_workosId", (q) => q.eq("workosId", organization))
      .unique();
    if (held !== null) continue;
    const open = await ctx.db
      .query("backfills")
      .withIndex("by_scope_target", (q) =>
        q.eq("scope", "organization").eq("target", organization),
      )
      .order("desc")
      .first();
    if (open !== null && open.startedAt >= row.startedAt) continue;
    await queue.open("organization", organization, "reconcile", row.startedAt);
  }
  return last;
}

// Absence is reconciled against the snapshot's own start: a row the listing did not see is
// tombstoned only when nothing has touched it since the snapshot began.
export const reconcile = internalMutation({
  args: {
    id: v.id("backfills"),
    step: v.number(),
    after: v.union(v.string(), v.null()),
    handles: vHandles,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await current(ctx, args.id, "reconcile", args.step, args.after);
    if (row === null) return false;
    if (row.scope === "organizations" && row.step >= 1) {
      const queue = new Queue(ctx, args.handles);
      await proceed(ctx, queue, row, await strays(ctx, queue, row, args.after));
      return true;
    }
    const result = await page(ctx, row, args.after);
    const mirror = new Mirror(ctx, args.handles);
    const { table, kind, cascade } = result;
    for (const doc of result.page) {
      if (doc.deleted || doc.seen === row._id || doc.at >= row.startedAt)
        continue;
      try {
        await ctx.db.patch(table, doc._id, {
          deleted: true,
          at: row.startedAt,
        });
        if (kind === null) continue;
        const { _id, _creationTime, seen: _seen, ...rest } = doc;
        const after = { ...rest, deleted: true, at: row.startedAt };
        await mirror.bury(
          kind,
          after,
          cascade === undefined || !("workosId" in doc)
            ? undefined
            : [cascade, doc.workosId, row.startedAt],
        );
      } catch (error) {
        throw thrown(error);
      }
    }
    await proceed(
      ctx,
      mirror.backfills,
      row,
      result.isDone ? null : result.continueCursor,
    );
    return true;
  },
});

export const step = internalAction({
  args: { id: v.id("backfills"), handles: vHandles },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.backfill.get, { id: args.id });
    if (row === null || row.phase === "done") return null;
    const after = row.after ?? null;
    if (row.phase === "reconcile") {
      try {
        await ctx.runMutation(internal.backfill.reconcile, {
          id: row._id,
          step: row.step,
          after,
          handles: args.handles,
        });
      } catch (error) {
        await recover(ctx, error, Credentials.read());
      }
      return null;
    }
    const secrets = Credentials.read();
    const endpoint = LISTS[row.scope][row.step];
    try {
      let items: Update[] = [];
      let next: string | null = null;
      let at = row.startedAt;
      if (endpoint !== undefined) {
        const [path, query] = request(endpoint, row.target ?? "");
        const reply = await new Api(secrets).get(path, {
          ...query,
          limit: String(PAGE_SIZE),
          after: after ?? undefined,
        });
        const list = decodeList(reply.body);
        items = list.items.map((item) =>
          decodeItem(endpoint, item, row.target ?? "", reply.date),
        );
        next = list.after;
        at = reply.date;
      }
      await ctx.runMutation(internal.backfill.list, {
        id: row._id,
        step: row.step,
        after,
        items,
        next,
        at,
        handles: args.handles,
      });
    } catch (error) {
      await recover(ctx, error, secrets);
    }
    return null;
  },
});
