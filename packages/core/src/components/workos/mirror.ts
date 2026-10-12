/**
 * Every write to the copy. A row lands only over an older one, the app's
 * handler for its kind runs in the same transaction, and a deleted parent
 * opens the reconcile that removes its children.
 *
 * @module
 */
import type { FunctionHandle } from "convex/server";
import type {
  ChangeKind,
  Domain,
  Handles,
  Organization,
  Update,
} from "./changes.ts";
import { lane } from "./lane.ts";
import type { BackfillScope } from "./schema.ts";
import { internal } from "./_generated/api.ts";
import type { Doc, Id } from "./_generated/dataModel.ts";
import type { MutationCtx } from "./_generated/server.ts";

const OPEN = 16;

type Seen = Id<"backfills"> | undefined;
type Outcome = "stale" | "upsert" | "remove" | "buried";

export type Table =
  | "organizations"
  | "domains"
  | "memberships"
  | "users"
  | "connections"
  | "directories"
  | "directoryUsers"
  | "directoryGroups"
  | "directoryMembers";
type Body<T extends Table> = T extends Table
  ? Omit<Doc<T>, "_id" | "_creationTime" | "seen">
  : never;

// One member per table, so a row can only be landed in the table its type belongs to.
type Entry = { [T in Table]: { table: T; row: Body<T> } }[Table];

// A write lands only over an older row: a replayed event, a stale snapshot page and a tombstone
// all lose to whatever the mirror already holds at the same or a later WorkOS time.
function judge(
  found: Doc<Table> | null,
  row: { at: number; deleted: boolean },
): Outcome {
  if (found !== null && found.at >= row.at) return "stale";
  if (!row.deleted) return "upsert";
  return found === null || found.deleted ? "buried" : "remove";
}

// The lane holds at most one job per open backfill: each step enqueues its own next page, and
// `drive` starts only rows whose job has finished, failed or was never enqueued.
export class Queue {
  private touched = false;

  constructor(
    private readonly ctx: MutationCtx,
    private readonly handles: Handles,
  ) {}

  get opened(): boolean {
    return this.touched;
  }

  async open(
    scope: BackfillScope,
    target: string | undefined,
    phase: "list" | "reconcile",
    startedAt: number,
  ): Promise<Id<"backfills">> {
    const last = await this.ctx.db
      .query("backfills")
      .withIndex("by_scope_target", (q) =>
        q.eq("scope", scope).eq("target", target),
      )
      .order("desc")
      .first();
    if (last !== null && last.phase !== "done") {
      await this.ctx.db.patch("backfills", last._id, {
        phase: "done",
        work: undefined,
      });
    }
    this.touched = true;
    return await this.ctx.db.insert("backfills", {
      scope,
      target,
      phase,
      step: 0,
      startedAt,
    });
  }

  async enqueue(id: Id<"backfills">) {
    return await lane.enqueueAction(this.ctx, internal.backfill.step, {
      id,
      handles: this.handles,
    });
  }

  async drive(): Promise<number> {
    const rows: Doc<"backfills">[] = [];
    for (const phase of ["list", "reconcile"] as const) {
      rows.push(
        ...(await this.ctx.db
          .query("backfills")
          .withIndex("by_phase", (q) => q.eq("phase", phase))
          .take(OPEN)),
      );
    }
    const works = rows.flatMap((row) =>
      row.work === undefined ? [] : [row.work],
    );
    const states = await lane.statusBatch(this.ctx, works);
    const live = new Set(
      works.filter((_, index) => states[index]?.state !== "finished"),
    );
    let started = 0;
    for (const row of rows) {
      if (row.work !== undefined && live.has(row.work)) continue;
      await this.ctx.db.patch("backfills", row._id, {
        work: await this.enqueue(row._id),
      });
      started += 1;
    }
    return started;
  }
}

export class Emitter {
  constructor(private readonly handles: Handles) {}

  async emit(
    ctx: MutationCtx,
    kind: ChangeKind,
    operation: "upsert" | "remove",
    after: object,
  ): Promise<void> {
    const handle = this.handles[kind];
    if (handle === undefined) return;
    // The handle is the string the app minted; Convex's component guidelines receive one this way.
    // ast-grep-ignore: no-forcing-cast
    await ctx.runMutation(handle as FunctionHandle<"mutation">, {
      kind: operation,
      after,
    });
  }
}

// Every mirrored write goes through here, so the guard, the app's callback and the cascade into a
// deleted parent's children commit together with the row.
export class Mirror {
  private readonly queue: Queue;
  private readonly emitter: Emitter;

  constructor(
    private readonly ctx: MutationCtx,
    handles: Handles,
  ) {
    this.queue = new Queue(ctx, handles);
    this.emitter = new Emitter(handles);
  }

  async write(
    update: Update,
    seen?: Id<"backfills">,
    domainsSeen?: Id<"backfills">,
  ) {
    switch (update.kind) {
      case "organization":
        return await this.organization(
          update.row,
          update.domains,
          seen,
          domainsSeen,
        );
      case "domain":
        return await this.land({ table: "domains", row: update.row }, seen);
      case "membership": {
        const outcome = await this.land(
          { table: "memberships", row: update.row },
          seen,
        );
        return await this.settle("membership", outcome, update.row);
      }
      case "user": {
        const outcome = await this.land(
          { table: "users", row: update.row },
          seen,
        );
        return await this.settle("user", outcome, update.row);
      }
      case "connection": {
        const outcome = await this.land(
          { table: "connections", row: update.row },
          seen,
        );
        return await this.settle("connection", outcome, update.row);
      }
      case "directory": {
        const { row } = update;
        const outcome = await this.land({ table: "directories", row }, seen);
        return await this.settle("directory", outcome, row, [
          "directory",
          row.workosId,
          row.at,
        ]);
      }
      case "directoryUser": {
        const { row } = update;
        const outcome = await this.land({ table: "directoryUsers", row }, seen);
        return await this.settle("directoryUser", outcome, row, [
          "user",
          row.workosId,
          row.at,
        ]);
      }
      case "directoryGroup": {
        const { row } = update;
        const outcome = await this.land(
          { table: "directoryGroups", row },
          seen,
        );
        return await this.settle("directoryGroup", outcome, row, [
          "group",
          row.workosId,
          row.at,
        ]);
      }
      case "directoryMember": {
        const outcome = await this.land(
          { table: "directoryMembers", row: update.row },
          seen,
        );
        return await this.settle("directoryMember", outcome, update.row);
      }
    }
  }

  async bury(
    kind: ChangeKind,
    after: object,
    cascade?: [BackfillScope, string, number],
  ) {
    await this.emitter.emit(this.ctx, kind, "remove", after);
    if (cascade !== undefined)
      await this.queue.open(cascade[0], cascade[1], "reconcile", cascade[2]);
  }

  get backfills(): Queue {
    return this.queue;
  }

  private async find(entry: Entry): Promise<Doc<Table> | null> {
    const { db } = this.ctx;
    if (entry.table === "directoryMembers") {
      const { group, user } = entry.row;
      return await db
        .query("directoryMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("group", group).eq("user", user),
        )
        .unique();
    }
    const { workosId } = entry.row;
    return await db
      .query(entry.table)
      .withIndex("by_workosId", (q) => q.eq("workosId", workosId))
      .unique();
  }

  private async land(entry: Entry, seen: Seen): Promise<Outcome> {
    const { db } = this.ctx;
    const found = await this.find(entry);
    const outcome = judge(found, entry.row);
    if (outcome === "stale") {
      if (found !== null && seen !== undefined && found.seen !== seen) {
        await db.patch(entry.table, found._id, { seen });
      }
    } else if (found === null) {
      await db.insert(entry.table, { ...entry.row, seen });
    } else {
      await db.replace(entry.table, found._id, {
        ...entry.row,
        seen: seen ?? found.seen,
      });
    }
    return outcome;
  }

  private async settle(
    kind: ChangeKind,
    outcome: Outcome,
    row: object,
    cascade?: [BackfillScope, string, number],
  ): Promise<void> {
    if (outcome === "upsert")
      await this.emitter.emit(this.ctx, kind, "upsert", row);
    if (outcome === "remove")
      await this.emitter.emit(this.ctx, kind, "remove", row);
    if (
      (outcome === "remove" || outcome === "buried") &&
      cascade !== undefined
    ) {
      await this.queue.open(cascade[0], cascade[1], "reconcile", cascade[2]);
    }
  }

  private async organization(
    row: Organization,
    domains: Domain[],
    seen: Seen,
    domainsSeen: Seen,
  ): Promise<void> {
    const { db } = this.ctx;
    const outcome = await this.land({ table: "organizations", row }, seen);
    if (outcome === "upsert") {
      const listed = new Set(domains.map((item) => item.workosId));
      // Every domain the organization holds, however many: one left out
      // would stay live after WorkOS dropped it.
      const held = db
        .query("domains")
        .withIndex("by_organization", (q) =>
          q.eq("organization", row.workosId),
        );
      for await (const item of held) {
        if (!item.deleted && !listed.has(item.workosId) && item.at < row.at) {
          await db.patch("domains", item._id, { deleted: true, at: row.at });
        }
      }
    }
    // A stale organization event carries an older domain set and leaves the domains alone. A
    // listing's domains still go through their own guard: a domain event moves no organization's
    // time, so a listed domain can be newer than everything the mirror holds of its organization.
    if (outcome !== "stale" || domainsSeen !== undefined) {
      for (const item of domains)
        await this.land({ table: "domains", row: item }, domainsSeen);
    }
    await this.settle("organization", outcome, row, [
      "organization",
      row.workosId,
      row.at,
    ]);
  }
}
