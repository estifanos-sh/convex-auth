/**
 * Keeping the copy: `pull` fetches the next page from WorkOS, decodes it and
 * stages it, and `land` applies a staged page to the copy, in order, and
 * returns what changed. The app runs both: it pulls when it wants the copy
 * current, and lands the page in its own mutation, so it acts on the changes
 * in the transaction that makes them. Each pull takes one page; pull again
 * until `pull` returns null.
 *
 * The two never conflict, by construction. `stage` reads nothing and only
 * inserts a page. `land` reads the cursor row, its page by id, and the pages
 * staged more than {@link STALE_MS} before it started; it writes the cursor,
 * deletes its page and those stale ones, and writes the copy. A page `stage`
 * inserts is none of those, so no `stage` is ever in a `land`'s read set,
 * nor a `land`'s writes in a `stage`'s. Two lands conflict on the cursor,
 * which is what orders them.
 *
 * @module
 */
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api.ts";
import type { Id } from "./_generated/dataModel.ts";
import {
  action,
  type DatabaseReader,
  type DatabaseWriter,
  env,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server.ts";
import { Copy } from "./copy.ts";
import { Fill, vPosition } from "./fill.ts";
import {
  type Landed,
  vLanded,
  vWorkosEvent,
  type WorkosEvent,
} from "./validators.ts";
import { Workos } from "./workos.ts";

/** Rows `reset` removes in one mutation. */
const BATCH = 500;

/**
 * How old a staged page is before `land` deletes it unlanded: a pull that
 * lost to another from the same cursor, or that no one landed.
 */
const STALE_MS = 60 * 60 * 1000;

export const vPulled = v.object({
  /** The page this one follows, null for the first. */
  after: v.union(v.null(), v.string()),
  /** This page, which `land` takes. */
  until: v.string(),
});
export type Pulled = Infer<typeof vPulled>;

/**
 * Stage the page after the copy's cursor, and return it, or null when
 * WorkOS has nothing newer. Two pulls from one cursor stage two pages, of
 * which `land` applies the first it is given, and refuses the other.
 */
export const pull = action({
  args: {},
  returns: v.union(v.null(), vPulled),
  handler: async (ctx): Promise<Pulled | null> => {
    const cursor: Cursor | null = await ctx.runQuery(
      internal.events.cursor,
      {},
    );
    const fill = new Fill(
      new Workos(env.CLIENT_SECRET),
      async (after): Promise<string | null> =>
        await ctx.runQuery(internal.events.directory, { after }),
    );
    const now = Date.now();
    const page = await fill.next(cursor?.position ?? Fill.start(now), now);
    if (page === null) return null;
    const after: Id<"pages"> | null = cursor?.page ?? null;
    const until: Id<"pages"> = await ctx.runMutation(internal.events.stage, {
      after,
      ...page,
    });
    return { after, until };
  },
});

async function held(db: DatabaseReader) {
  return await db.query("cursor").first();
}

const vCursor = v.object({ page: v.id("pages"), position: vPosition });
type Cursor = Infer<typeof vCursor>;

/** The last page that landed and where it left the copy, or null for an empty copy. */
export const cursor = internalQuery({
  args: {},
  returns: v.union(v.null(), vCursor),
  handler: async (ctx) => {
    const row = await held(ctx.db);
    return row === null ? null : { page: row.page, position: row.position };
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

/** Stage a page after `after`. It reads nothing, so it conflicts with nothing. */
export const stage = internalMutation({
  args: {
    after: v.union(v.null(), v.id("pages")),
    position: vPosition,
    events: v.array(vWorkosEvent),
  },
  returns: v.id("pages"),
  handler: async (ctx, args) => await ctx.db.insert("pages", args),
});

/**
 * Apply the staged page `until` to the copy, and return its changes. A page
 * that no longer follows the cursor, because another page landed after it
 * was pulled, is dropped, and one already landed or dropped is gone: both
 * return `landed: false`.
 */
export const land = mutation({
  args: { until: v.id("pages") },
  returns: vLanded,
  handler: async (ctx, { until }): Promise<Landed> => {
    const landed = await apply(ctx.db, until);
    await prune(ctx.db);
    return landed;
  },
});

async function apply(db: DatabaseWriter, until: Id<"pages">): Promise<Landed> {
  const page = await db.get("pages", until);
  if (page === null) return { landed: false };
  await db.delete("pages", until);
  const cursor = await held(db);
  if (page.after !== (cursor?.page ?? null)) return { landed: false };
  const copy = new Copy(db);
  const changes: WorkosEvent[] = [];
  for (const event of page.events) changes.push(...(await copy.apply(event)));
  const moved = { page: until, position: page.position };
  if (cursor === null) await db.insert("cursor", moved);
  else await db.replace("cursor", cursor._id, moved);
  return { landed: true, changes };
}

/** Delete pages staged long before this mutation started, unlanded. */
async function prune(db: DatabaseWriter): Promise<void> {
  const stale = await db
    .query("pages")
    .withIndex("by_creation_time", (q) =>
      q.lt("_creationTime", Date.now() - STALE_MS),
    )
    .take(BATCH);
  for (const page of stale) await db.delete("pages", page._id);
}

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
    for (const table of ["cursor", "pages", "objects"] as const) {
      for (const row of await ctx.db.query(table).take(left)) {
        await ctx.db.delete(table, row._id);
        left -= 1;
      }
      if (left === 0) return { done: false };
    }
    return { done: true };
  },
});
