/**
 * The event stream: the directory sync's one reader of WorkOS's `/events`.
 *
 * A pass reads forward from the stored cursor a page at a time and applies
 * each page in one mutation. Before the first pass the stream fixes a
 * boundary, a WorkOS time, and starts the backfills that list everything as
 * of then; the stream then reads forward from that boundary, so no change made
 * while the listings run is lost.
 *
 * @module
 */
import { vOnCompleteArgs } from "@convex-dev/workpool";
import { v } from "convex/values";
import { Api, ApiError } from "./workosApi.ts";
import { Mirror, Queue } from "./mirror.ts";
import { type Handles, vEvent, vHandles } from "./changes.ts";
import { recover, thrown } from "./faults.ts";
import { lane, PAGE_SIZE } from "./lane.ts";
import { type SyncFailure, vSyncFailure } from "./schema.ts";
import { Credentials } from "./credentials.ts";
import { decodeEvents, decodeList, EVENTS } from "./wire.ts";
import { internal } from "./_generated/api.ts";
import type { Doc } from "./_generated/dataModel.ts";
import type { ActionCtx, MutationCtx } from "./_generated/server.ts";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server.ts";

const PAGES = 40;
// WorkOS keeps events for 90 days; a boundary older than this may already have lost some.
const RETAINED = 80 * 24 * 60 * 60 * 1000;

async function stream(ctx: MutationCtx) {
  return await ctx.db.query("eventStream").first();
}

async function enqueue(ctx: MutationCtx, handles: Handles) {
  return await lane.enqueueAction(
    ctx,
    internal.stream.pass,
    { handles },
    { onComplete: internal.stream.complete },
  );
}

// The error is written only when it changes, so a failure repeated every minute costs no write.
async function record(
  ctx: MutationCtx,
  row: Doc<"eventStream"> | null,
  error: SyncFailure,
) {
  if (row === null) {
    await ctx.db.insert("eventStream", { bounded: false, cursor: null, error });
    return;
  }
  const held = row.error;
  if (
    held === undefined ||
    held.kind !== error.kind ||
    held.event !== error.event ||
    held.detail !== error.detail ||
    held.key !== error.key
  ) {
    await ctx.db.patch("eventStream", row._id, { error });
  }
}

// One pass at a time: a sweep enqueues only once the stored pass has finished, and a pass that
// ends on a full page enqueues the next. A sweep that finds a pass running may come after that
// pass's last read, so it asks for one more pass, writing the row only the first time it asks.
export const sweep = mutation({
  args: { handles: vHandles },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await stream(ctx);
    let { error } = row ?? {};
    if (error?.kind === "credentials") {
      const { apiKey } = await Credentials.report();
      if (apiKey === null || apiKey === error.key) return false;
      error = undefined;
    }
    const state =
      row?.work === undefined
        ? "finished"
        : (await lane.status(ctx, row.work)).state;
    if (state === "running" && row !== null && row.again !== true) {
      await ctx.db.patch("eventStream", row._id, { again: true });
    }
    if (state !== "finished") return false;
    const work = await enqueue(ctx, args.handles);
    if (row === null)
      await ctx.db.insert("eventStream", {
        bounded: false,
        cursor: null,
        work,
      });
    else
      await ctx.db.patch("eventStream", row._id, {
        work,
        error,
        again: undefined,
      });
    return true;
  },
});

// Only a pass that caught up starts the backfills the lane is not already running: a listing must
// not run ahead of the stream it is reconciled against, or an older event applied after it brings
// back a domain the listed organization had already dropped.
export const finish = internalMutation({
  args: { handles: vHandles, full: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await stream(ctx);
    if (row === null) return null;
    if (args.full || row.again === true) {
      await ctx.db.patch("eventStream", row._id, {
        work: await enqueue(ctx, args.handles),
        again: undefined,
      });
    }
    if (!args.full) await new Queue(ctx, args.handles).drive();
    return null;
  },
});

// A pass that ran out of retries leaves its failure on the row until a later pass applies a page.
export const complete = internalMutation({
  args: vOnCompleteArgs(),
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.result.kind !== "failed") return null;
    await record(ctx, await stream(ctx), {
      kind: "transient",
      detail: args.result.error,
    });
    return null;
  },
});

export const begin = internalQuery({
  args: {},
  returns: v.object({
    bounded: v.boolean(),
    cursor: v.union(v.string(), v.null()),
    since: v.number(),
  }),
  handler: async (ctx) => {
    const row = await ctx.db.query("eventStream").first();
    return {
      bounded: row?.bounded ?? false,
      cursor: row?.cursor ?? null,
      since: row?.since ?? 0,
    };
  },
});

const Position = v.object({
  cursor: v.union(v.string(), v.null()),
  since: v.number(),
});

// The boundary is a WorkOS time fixed before anything is listed: the stream reads forward from it
// until its first event gives a cursor, so every change after the snapshot began still reaches the
// mirror. A restart answers an expired cursor, and only the pass that read that cursor may move it.
export const reset = internalMutation({
  args: {
    from: v.union(v.string(), v.null()),
    restart: v.boolean(),
    at: v.number(),
  },
  returns: Position,
  handler: async (ctx, args) => {
    const row = await stream(ctx);
    if (row?.bounded === true && (!args.restart || row.cursor !== args.from)) {
      return { cursor: row.cursor, since: row.since ?? 0 };
    }
    const error = args.restart ? { kind: "expired" as const } : undefined;
    const fields = {
      bounded: true,
      cursor: null,
      since: args.at,
      error,
      work: row?.work,
      again: row?.again,
    };
    if (row === null) await ctx.db.insert("eventStream", fields);
    else await ctx.db.replace("eventStream", row._id, fields);
    const mirror = new Mirror(ctx, {});
    await mirror.backfills.open("organizations", undefined, "list", args.at);
    await mirror.backfills.open("users", undefined, "list", args.at);
    return { cursor: null, since: args.at };
  },
});

export const apply = internalMutation({
  args: {
    from: v.union(v.string(), v.null()),
    to: v.union(v.string(), v.null()),
    events: v.array(vEvent),
    handles: vHandles,
  },
  returns: v.union(
    v.null(),
    v.object({ cursor: v.union(v.string(), v.null()) }),
  ),
  handler: async (ctx, args) => {
    const row = await stream(ctx);
    if (row === null || !row.bounded || row.cursor !== args.from) return null;
    const mirror = new Mirror(ctx, args.handles);
    for (const event of args.events) {
      try {
        await mirror.write(event.update);
        if (event.activated && event.update.kind === "directory") {
          await mirror.backfills.open(
            "directory",
            event.update.row.workosId,
            "list",
            event.at,
          );
        }
      } catch (error) {
        throw thrown(error, event.id);
      }
    }
    const cursor = args.to ?? args.from;
    if (cursor !== row.cursor || row.error !== undefined) {
      await ctx.db.patch("eventStream", row._id, { cursor, error: undefined });
    }
    return { cursor };
  },
});

export const fail = internalMutation({
  args: vSyncFailure,
  returns: v.null(),
  handler: async (ctx, args) => {
    await record(ctx, await stream(ctx), args);
    return null;
  },
});

async function boundary(
  ctx: ActionCtx,
  api: Api,
  from: string | null,
  restart: boolean,
) {
  return await ctx.runMutation(internal.stream.reset, {
    from,
    restart,
    at: await api.clock(EVENTS),
  });
}

// A pass ends at a short page, at a recorded failure, or at its page bound.
export const pass = internalAction({
  args: { handles: vHandles },
  returns: v.null(),
  handler: async (ctx, args) => {
    const secrets = Credentials.read();
    const api = new Api(secrets);
    const start = await ctx.runQuery(internal.stream.begin, {});
    let { cursor, since } = start;
    try {
      if (!start.bounded)
        ({ cursor, since } = await boundary(ctx, api, null, false));
      let full = true;
      for (let page = 0; full && page < PAGES; page += 1) {
        const reply = await api.events(
          EVENTS,
          cursor === null ? { since } : { after: cursor },
          PAGE_SIZE,
        );
        // A stream that never saw an event reads from its boundary, so nothing refuses a read
        // that WorkOS's retention has outrun: the pass restarts it as it would an expired cursor.
        if (cursor === null && reply.date - since > RETAINED) {
          throw new ApiError(
            "expired",
            410,
            "the boundary is older than WorkOS keeps events",
          );
        }
        const list = decodeList(reply.body);
        const { events, last } = decodeEvents(list.items);
        const result = await ctx.runMutation(internal.stream.apply, {
          from: cursor,
          to: last,
          events,
          handles: args.handles,
        });
        if (result === null) return null;
        cursor = result.cursor;
        full = list.items.length >= PAGE_SIZE;
      }
      await ctx.runMutation(internal.stream.finish, {
        handles: args.handles,
        full,
      });
    } catch (error) {
      if (await recover(ctx, error, secrets))
        await boundary(ctx, api, cursor, true);
    }
    return null;
  },
});
