/**
 * The directory sync: keeps the component's copy of the WorkOS environment's
 * organizations, domains, SSO connections and directories (users, groups and
 * memberships) current, and runs the app's handler for each change.
 *
 * A run holds a lease on the one `sync` row. The first run fixes a boundary,
 * a WorkOS time, then lists everything (the backfill), then removes what an
 * earlier generation held and the listing no longer showed (the prune), then
 * reads WorkOS's event stream forward from the boundary. Every later run reads
 * the stream from its cursor. Each page is applied in one mutation that checks
 * the lease, so two runs never apply the same page.
 *
 * A run starts from the app's cron (`start`) or from WorkOS's webhook, which
 * only rings: the event stream stays the one source of truth.
 *
 * @module
 */
import { v } from "convex/values";
import { internal } from "./_generated/api.ts";
import type { Doc } from "./_generated/dataModel.ts";
import type { MutationCtx } from "./_generated/server.ts";
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server.ts";
import { EVENTS, PAGE_SIZE } from "./constants.ts";
import { type ChangeHandler, Mirror } from "./mirror.ts";
import { callWorkos, WorkosApiError } from "./rest.ts";
import { type BackfillPosition, vBackfillPosition } from "./schema.ts";
import {
  decodeEvents,
  decodeList,
  decodeListed,
  decodeMember,
  vUpdate,
} from "./wire.ts";

/** A run older than this lost its lease, since an action runs 10 min at most. */
const LEASE_MS = 15 * 60 * 1000;
/** How far before WorkOS's clock a boundary is set. Replays are harmless. */
const BOUNDARY_SKEW_MS = 60 * 1000;
/** Pages one run applies before it hands over to a fresh run. */
const STEPS_PER_RUN = 100;
/** Rows one prune step removes. */
const PRUNE_BATCH = 50;

/**
 * Function handles are strings that Convex brands, and a stored one loses the
 * brand. Convex mints them with this scheme.
 */
function isChangeHandler(value: string): value is ChangeHandler {
  return value.startsWith("function://");
}

async function state(ctx: MutationCtx): Promise<Doc<"sync"> | null> {
  return await ctx.db.query("sync").first();
}

/** Start a run, or ask the running one for another pass. */
async function ring(ctx: MutationCtx, row: Doc<"sync">): Promise<void> {
  if (row.run !== undefined && row.run.startedAt > Date.now() - LEASE_MS) {
    if (!row.again) await ctx.db.patch("sync", row._id, { again: true });
    return;
  }
  const run = { id: crypto.randomUUID(), startedAt: Date.now() };
  await ctx.db.patch("sync", row._id, { run, again: false });
  await ctx.scheduler.runAfter(0, internal.sync.run, { runId: run.id });
}

/**
 * Ask for a sync run with the app's change handler, a function handle to a
 * mutation taking `{ change }`. The app's cron calls this through the
 * `workos` method's `syncWorkosDirectory`.
 */
export const start = mutation({
  args: { onChange: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!isChangeHandler(args.onChange)) {
      throw new Error("onChange must be a function handle");
    }
    const row = await state(ctx);
    if (row === null) {
      const id = await ctx.db.insert("sync", {
        onChange: args.onChange,
        again: false,
        generation: 0,
        phase: "idle",
      });
      const inserted = await ctx.db.get("sync", id);
      if (inserted !== null) await ring(ctx, inserted);
      return null;
    }
    if (row.onChange !== args.onChange) {
      await ctx.db.patch("sync", row._id, { onChange: args.onChange });
    }
    await ring(ctx, { ...row, onChange: args.onChange });
    return null;
  },
});

/** The webhook's doorbell. Does nothing before the app first called `start`. */
export const doorbell = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const row = await state(ctx);
    if (row !== null) await ring(ctx, row);
    return null;
  },
});

/** Where the sync is, for the app's status page or its tests. */
export const status = query({
  args: {},
  returns: v.object({
    phase: v.union(
      v.literal("idle"),
      v.literal("backfill"),
      v.literal("prune"),
      v.literal("events"),
    ),
    running: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx) => {
    const row = await ctx.db.query("sync").first();
    return {
      phase: row?.phase ?? "idle",
      running:
        row?.run !== undefined && row.run.startedAt > Date.now() - LEASE_MS,
      error: row?.error,
    };
  },
});

/** The row, if `runId` still holds the lease. */
async function leased(ctx: MutationCtx, runId: string) {
  const row = await state(ctx);
  return row !== null && row.run?.id === runId ? row : null;
}

function mirror(ctx: MutationCtx, row: Doc<"sync">): Mirror {
  const onChange =
    row.onChange !== undefined && isChangeHandler(row.onChange)
      ? row.onChange
      : undefined;
  return new Mirror(ctx, row.generation, onChange);
}

export const read = internalQuery({
  args: { runId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      phase: v.union(
        v.literal("idle"),
        v.literal("backfill"),
        v.literal("prune"),
        v.literal("events"),
      ),
      backfill: v.optional(vBackfillPosition),
      since: v.optional(v.number()),
      cursor: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.query("sync").first();
    if (row === null || row.run?.id !== args.runId) return null;
    return {
      phase: row.phase,
      backfill: row.backfill,
      since: row.since,
      cursor: row.cursor,
    };
  },
});

/** Fix a boundary and begin a backfill under a new generation. */
export const bound = internalMutation({
  args: { runId: v.string(), at: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await leased(ctx, args.runId);
    if (row === null) return null;
    await ctx.db.patch("sync", row._id, {
      phase: "backfill",
      generation: row.generation + 1,
      backfill: { stage: "organizations" },
      since: args.at - BOUNDARY_SKEW_MS,
      cursor: undefined,
    });
    return null;
  },
});

/** Start over from a fresh boundary, after WorkOS refused the cursor. */
export const restart = internalMutation({
  args: { runId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await leased(ctx, args.runId);
    if (row === null) return null;
    await ctx.db.patch("sync", row._id, { phase: "idle", backfill: undefined });
    return null;
  },
});

/** The first directory after `afterId`, skipping deleted ones. */
async function nextDirectory(ctx: MutationCtx, afterId: string | undefined) {
  const following = ctx.db
    .query("directories")
    .withIndex("id", (q) => (afterId === undefined ? q : q.gt("id", afterId)));
  for await (const directory of following) {
    if (directory.deleted !== true) return directory.id;
  }
  return undefined;
}

async function nextGroup(
  ctx: MutationCtx,
  directoryId: string,
  afterId: string | undefined,
) {
  const next = await ctx.db
    .query("directoryGroups")
    .withIndex("directoryId_id", (q) =>
      afterId === undefined
        ? q.eq("directoryId", directoryId)
        : q.eq("directoryId", directoryId).gt("id", afterId),
    )
    .first();
  return next?.id;
}

/** Where the backfill goes once the listing at `position` is done. */
async function advance(
  ctx: MutationCtx,
  position: BackfillPosition,
): Promise<BackfillPosition | null> {
  switch (position.stage) {
    case "organizations":
      return { stage: "connections" };
    case "connections":
      return { stage: "directories" };
    case "directories": {
      const directoryId = await nextDirectory(ctx, undefined);
      return directoryId === undefined ? null : { stage: "users", directoryId };
    }
    case "users":
      return { stage: "groups", directoryId: position.directoryId };
    case "groups":
    case "members": {
      const groupId = await nextGroup(
        ctx,
        position.directoryId,
        position.stage === "members" ? position.groupId : undefined,
      );
      if (groupId !== undefined) {
        return { stage: "members", directoryId: position.directoryId, groupId };
      }
      const directoryId = await nextDirectory(ctx, position.directoryId);
      return directoryId === undefined ? null : { stage: "users", directoryId };
    }
  }
}

function samePosition(a: BackfillPosition | undefined, b: BackfillPosition) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Apply one backfill page, and move to the next. */
export const listed = internalMutation({
  args: {
    runId: v.string(),
    position: vBackfillPosition,
    updates: v.array(vUpdate),
    after: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await leased(ctx, args.runId);
    if (row === null || row.phase !== "backfill") return null;
    if (!samePosition(row.backfill, args.position)) return null;
    const copy = mirror(ctx, row);
    for (const update of args.updates) await copy.write(update);
    const next =
      args.after !== undefined
        ? { ...args.position, after: args.after }
        : await advance(ctx, args.position);
    await ctx.db.patch("sync", row._id, {
      phase: next === null ? "prune" : "backfill",
      backfill: next ?? undefined,
      error: undefined,
    });
    return null;
  },
});

/**
 * Remove up to a batch of rows that are gone: the contents of a directory
 * WorkOS deleted, then, after a backfill, every row an older generation wrote
 * that the listings did not show again. Returns whether there may be more.
 */
export const prune = internalMutation({
  args: { runId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await leased(ctx, args.runId);
    if (row === null) return false;
    const copy = mirror(ctx, row);
    const db = ctx.db;

    const deleted = await db
      .query("directories")
      .withIndex("deleted", (q) => q.eq("deleted", true))
      .first();
    if (deleted !== null) {
      const members = await db
        .query("directoryMembers")
        .withIndex("directoryId", (q) => q.eq("directoryId", deleted.id))
        .take(PRUNE_BATCH);
      for (const member of members) await copy.removeMember(member);
      if (members.length > 0) return true;
      const users = await db
        .query("directoryUsers")
        .withIndex("directoryId", (q) => q.eq("directoryId", deleted.id))
        .take(PRUNE_BATCH);
      for (const user of users) await copy.removeUser(user);
      if (users.length > 0) return true;
      const groups = await db
        .query("directoryGroups")
        .withIndex("directoryId_id", (q) => q.eq("directoryId", deleted.id))
        .take(PRUNE_BATCH);
      for (const group of groups) await copy.removeGroup(group);
      if (groups.length > 0) return true;
      await copy.removeDirectory(deleted);
      return true;
    }

    if (row.phase !== "prune") return false;
    const stale = <T>(rows: T[]) => rows.length > 0;
    const members = await db
      .query("directoryMembers")
      .withIndex("generation", (q) => q.lt("generation", row.generation))
      .take(PRUNE_BATCH);
    for (const member of members) await copy.removeMember(member);
    if (stale(members)) return true;
    const users = await db
      .query("directoryUsers")
      .withIndex("generation", (q) => q.lt("generation", row.generation))
      .take(PRUNE_BATCH);
    for (const user of users) await copy.removeUser(user);
    if (stale(users)) return true;
    const groups = await db
      .query("directoryGroups")
      .withIndex("generation", (q) => q.lt("generation", row.generation))
      .take(PRUNE_BATCH);
    for (const group of groups) await copy.removeGroup(group);
    if (stale(groups)) return true;
    const directories = await db
      .query("directories")
      .withIndex("generation", (q) => q.lt("generation", row.generation))
      .take(PRUNE_BATCH);
    // A directory with children left goes through the deletion path above.
    for (const directory of directories) {
      await db.patch("directories", directory._id, { deleted: true });
    }
    if (stale(directories)) return true;
    const connections = await db
      .query("connections")
      .withIndex("generation", (q) => q.lt("generation", row.generation))
      .take(PRUNE_BATCH);
    for (const connection of connections)
      await copy.removeConnection(connection);
    if (stale(connections)) return true;
    const domains = await db
      .query("domains")
      .withIndex("generation", (q) => q.lt("generation", row.generation))
      .take(PRUNE_BATCH);
    for (const domain of domains) await copy.removeDomain(domain);
    if (stale(domains)) return true;
    const organizations = await db
      .query("organizations")
      .withIndex("generation", (q) => q.lt("generation", row.generation))
      .take(PRUNE_BATCH);
    for (const organization of organizations) {
      await copy.removeOrganization(organization);
    }
    if (stale(organizations)) return true;
    await db.patch("sync", row._id, { phase: "events" });
    return true;
  },
});

/** Apply one page of events, and move the cursor past it. */
export const applied = internalMutation({
  args: {
    runId: v.string(),
    from: v.optional(v.string()),
    updates: v.array(vUpdate),
    last: v.optional(v.string()),
    date: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await leased(ctx, args.runId);
    if (row === null || row.phase !== "events" || row.cursor !== args.from) {
      return false;
    }
    const copy = mirror(ctx, row);
    for (const update of args.updates) await copy.write(update);
    await ctx.db.patch(
      "sync",
      row._id,
      args.last !== undefined
        ? { cursor: args.last, error: undefined }
        : row.cursor === undefined
          ? // No event since the boundary yet: move the boundary up, so it
            // never falls out of WorkOS's retention.
            { since: args.date - BOUNDARY_SKEW_MS, error: undefined }
          : { error: undefined },
    );
    return true;
  },
});

/** End a run: drop the lease, keep its error, and run again if asked. */
export const release = internalMutation({
  args: {
    runId: v.string(),
    error: v.optional(v.string()),
    more: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await leased(ctx, args.runId);
    if (row === null) return null;
    const again = row.again || args.more;
    await ctx.db.patch("sync", row._id, {
      run: undefined,
      again: false,
      ...(args.error !== undefined ? { error: args.error } : {}),
    });
    // A failed run waits for the next cron or webhook rather than looping.
    if (again && args.error === undefined) {
      await ring(ctx, { ...row, run: undefined, again: false });
    }
    return null;
  },
});

function listing(position: BackfillPosition) {
  const page = { limit: String(PAGE_SIZE), after: position.after };
  switch (position.stage) {
    case "organizations":
      return { path: "/organizations", query: page };
    case "connections":
      return { path: "/connections", query: page };
    case "directories":
      return { path: "/directories", query: page };
    case "users":
      return {
        path: "/directory_users",
        query: { ...page, directory: position.directoryId },
      };
    case "groups":
      return {
        path: "/directory_groups",
        query: { ...page, directory: position.directoryId },
      };
    case "members":
      return {
        path: "/directory_users",
        query: { ...page, group: position.groupId },
      };
  }
}

/** One run: the steps of the sync, until it has caught up or its budget ends. */
export const run = internalAction({
  args: { runId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const apiKey = env.CLIENT_SECRET;
    const { runId } = args;
    try {
      for (let step = 0; step < STEPS_PER_RUN; step += 1) {
        const at = await ctx.runQuery(internal.sync.read, { runId });
        if (at === null) return null;
        switch (at.phase) {
          case "idle": {
            const reply = await callWorkos(apiKey, {
              method: "GET",
              path: "/events",
              query: { events: EVENTS, limit: "1" },
            });
            await ctx.runMutation(internal.sync.bound, {
              runId,
              at: reply.date,
            });
            break;
          }
          case "backfill": {
            const position = at.backfill;
            if (position === undefined) return null;
            const request = listing(position);
            const reply = await callWorkos(apiKey, {
              method: "GET",
              ...request,
            });
            const page = decodeList(reply.body);
            const updates = page.items.map((item) =>
              position.stage === "members"
                ? decodeMember(item, position.groupId)
                : decodeListed(position.stage, item),
            );
            await ctx.runMutation(internal.sync.listed, {
              runId,
              position,
              updates,
              after: page.after,
            });
            break;
          }
          case "prune":
            await ctx.runMutation(internal.sync.prune, { runId });
            break;
          case "events": {
            if (await ctx.runMutation(internal.sync.prune, { runId })) break;
            let reply;
            try {
              reply = await callWorkos(apiKey, {
                method: "GET",
                path: "/events",
                query: {
                  events: EVENTS,
                  limit: String(PAGE_SIZE),
                  ...(at.cursor !== undefined
                    ? { after: at.cursor }
                    : { range_start: new Date(at.since ?? 0).toISOString() }),
                },
              });
            } catch (error) {
              // WorkOS documents no code for a cursor past its retention, so
              // any refusal of a cursor starts over from a fresh boundary. A
              // backfill loses nothing.
              if (
                at.cursor !== undefined &&
                error instanceof WorkosApiError &&
                !error.retryable &&
                error.status !== 401 &&
                error.status !== 403
              ) {
                await ctx.runMutation(internal.sync.restart, { runId });
                break;
              }
              throw error;
            }
            const page = decodeList(reply.body);
            const { updates, last } = decodeEvents(page.items);
            await ctx.runMutation(internal.sync.applied, {
              runId,
              from: at.cursor,
              updates,
              last,
              date: reply.date,
            });
            if (page.items.length < PAGE_SIZE) {
              // A page may have deleted a directory, whose contents go now
              // rather than on the next run.
              while (await ctx.runMutation(internal.sync.prune, { runId })) {
                // Each call removes one batch.
              }
              await ctx.runMutation(internal.sync.release, {
                runId,
                more: false,
              });
              return null;
            }
            break;
          }
        }
      }
      await ctx.runMutation(internal.sync.release, { runId, more: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("WorkOS directory sync stopped:", message);
      await ctx.runMutation(internal.sync.release, {
        runId,
        error: message.slice(0, 500),
        more: false,
      });
    }
    return null;
  },
});
