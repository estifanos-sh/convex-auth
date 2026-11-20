/**
 * Keeping the copy: `pull` fetches the next page from WorkOS, decodes it and
 * stages it, and `land` applies a staged page to the copy, in order, and
 * returns what changed. The app runs both: it pulls when it wants the copy
 * current, and lands the page in its own mutation, so it acts on the changes
 * in the transaction that makes them. Each pull takes one page; pull again
 * until `pull` returns null.
 *
 * @module
 */
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api.ts";
import type { Id } from "./_generated/dataModel.ts";
import {
  action,
  type DatabaseReader,
  env,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server.ts";
import { Copy } from "./copy.ts";
import { Fill, vPosition } from "./fill.ts";
import { vWorkosEvent, type WorkosEvent } from "./validators.ts";
import { Workos } from "./workos.ts";

/** Rows `reset` removes in one mutation. */
const BATCH = 500;

export const vPulled = v.object({
  /** The page this one follows, null for the first. */
  after: v.union(v.null(), v.string()),
  /** This page, which `land` takes. */
  until: v.string(),
});
export type Pulled = Infer<typeof vPulled>;

/**
 * Stage the page after the copy's cursor, and return it, or null when
 * WorkOS has nothing newer. Two pulls from one cursor stage one page, and a
 * pull that a landing overtook fetches again from the new cursor.
 */
export const pull = action({
  args: {},
  returns: v.union(v.null(), vPulled),
  handler: async (ctx): Promise<Pulled | null> => {
    const fill = new Fill(
      new Workos(env.CLIENT_SECRET),
      async (after): Promise<string | null> =>
        await ctx.runQuery(internal.events.directory, { after }),
    );
    for (;;) {
      const cursor: Cursor | null = await ctx.runQuery(
        internal.events.cursor,
        {},
      );
      const now = Date.now();
      const page = await fill.next(cursor?.position ?? Fill.start(now), now);
      if (page === null) return null;
      const after: Id<"pages"> | null = cursor?.id ?? null;
      const until: Id<"pages"> | null = await ctx.runMutation(
        internal.events.stage,
        { after, ...page },
      );
      if (until !== null) return { after, until };
    }
  },
});

async function held(db: DatabaseReader) {
  return await db
    .query("pages")
    .withIndex("state_after", (q) => q.eq("state", "landed"))
    .unique();
}

const vCursor = v.object({ id: v.id("pages"), position: vPosition });
type Cursor = Infer<typeof vCursor>;

/** The landed page, which is where the copy is, or null for an empty copy. */
export const cursor = internalQuery({
  args: {},
  returns: v.union(v.null(), vCursor),
  handler: async (ctx) => {
    const landed = await held(ctx.db);
    return landed === null
      ? null
      : { id: landed._id, position: landed.position };
  },
});

/** The copy's first directory after `after`, in id order. */
export const directory = internalQuery({
  args: { after: v.optional(v.string()) },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { after }) => {
    const next = await ctx.db
      .query("objects")
      .withIndex("object_id", (q) => {
        const directories = q.eq("object", "directory");
        return after === undefined ? directories : directories.gt("id", after);
      })
      .first();
    return next?.id ?? null;
  },
});

/**
 * Stage a page after `after`, or return the one already staged there. A
 * page is only staged after the cursor, so every staged page follows it:
 * when the cursor has moved since `after` was read, this stages nothing and
 * returns null.
 */
export const stage = internalMutation({
  args: {
    after: v.union(v.null(), v.id("pages")),
    position: vPosition,
    events: v.array(vWorkosEvent),
  },
  returns: v.union(v.null(), v.id("pages")),
  handler: async (ctx, args) => {
    const cursor = await held(ctx.db);
    if (args.after !== (cursor?._id ?? null)) return null;
    const staged = await ctx.db
      .query("pages")
      .withIndex("state_after", (q) =>
        q.eq("state", "staged").eq("after", args.after),
      )
      .first();
    if (staged !== null) return staged._id;
    return await ctx.db.insert("pages", { state: "staged", ...args });
  },
});

/**
 * Apply the staged page `until` to the copy, and return its changes. A page
 * that already landed changes nothing, and one that no longer follows the
 * cursor, because a `reset` ran after it was pulled, is dropped: both return
 * no changes.
 */
export const land = mutation({
  args: { until: v.id("pages") },
  returns: v.array(vWorkosEvent),
  handler: async (ctx, { until }) => {
    const page = await ctx.db.get("pages", until);
    if (page === null || page.state === "landed") return [];
    const cursor = await held(ctx.db);
    if (page.after !== (cursor?._id ?? null)) {
      await ctx.db.delete("pages", until);
      return [];
    }
    const copy = new Copy(ctx.db);
    const changes: WorkosEvent[] = [];
    for (const event of page.events) changes.push(...(await copy.apply(event)));
    if (cursor !== null) await ctx.db.delete("pages", cursor._id);
    await ctx.db.replace("pages", until, {
      state: "landed",
      after: page.after,
      position: page.position,
    });
    return changes;
  },
});

/**
 * Empty the copy and forget its cursor, a batch at a time, so the next pull
 * fills it again: for a deployment idle longer than WorkOS keeps events (90
 * days). Run it until it returns `done`.
 */
export const reset = mutation({
  args: {},
  returns: v.object({ done: v.boolean() }),
  handler: async (ctx) => {
    let left = BATCH;
    for (const table of ["pages", "objects"] as const) {
      for (const row of await ctx.db.query(table).take(left)) {
        await ctx.db.delete(table, row._id);
        left -= 1;
      }
      if (left === 0) return { done: false };
    }
    return { done: true };
  },
});
