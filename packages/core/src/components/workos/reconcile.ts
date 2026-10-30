/**
 * Reconcile: list everything WorkOS holds, write it into the copy, and remove
 * what the listings no longer show. It is how a new deployment fills its copy
 * and how deliveries the webhook missed are repaired: WorkOS retries a
 * failed delivery for a few minutes in staging, and for up to 3 days in
 * production.
 *
 * A reconcile that starts at time T stamps every row it lists with T. Each
 * page is fetched in an action and written in one mutation. Once the listings
 * are done, it removes, a batch per mutation, every row stamped before T: a
 * webhook delivery during the reconcile stamps its row with its own, later
 * time, so it is kept. A run hands over to a fresh action before an action's
 * time limit.
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
  mutation,
} from "./_generated/server.ts";
import { PAGE_SIZE } from "./constants.ts";
import { changeHandler, directoryOf, Mirror } from "./mirror.ts";
import { callWorkos } from "./rest.ts";
import { type BackfillPosition, vBackfillPosition } from "./schema.ts";
import { decodeList, decodeListed, decodeMember, vUpdate } from "./wire.ts";

/** Pages one action applies before it hands over to a fresh one. */
const PAGES_PER_RUN = 100;
/** Rows one removal step removes. */
const BATCH = 50;

const vStep = v.union(
  vBackfillPosition,
  v.object({ stage: v.literal("prune") }),
);

/** The copy, with the app's handler from the registered webhook. */
async function mirror(ctx: MutationCtx, generation: number): Promise<Mirror> {
  const webhook = await ctx.db.query("webhook").first();
  if (webhook === null) {
    throw new Error("Register the webhook (webhook.register) before this");
  }
  return new Mirror(ctx, generation, changeHandler(webhook.onChange));
}

/**
 * Start a reconcile. It runs in the background, and the app's handler runs
 * for every change it makes. Run it on every deploy, after
 * `webhook.register`, which records the handler.
 */
export const start = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if ((await ctx.db.query("webhook").first()) === null) {
      throw new Error("Register the webhook (webhook.register) before this");
    }
    await ctx.scheduler.runAfter(0, internal.reconcile.run, {
      generation: Date.now(),
      step: { stage: "organizations" },
    });
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

/** Where reconcile goes once the listing at `position` is done. */
async function advance(
  ctx: MutationCtx,
  position: BackfillPosition,
): Promise<BackfillPosition | { stage: "prune" }> {
  switch (position.stage) {
    case "organizations":
      return { stage: "connections" };
    case "connections":
      return { stage: "directories" };
    case "directories": {
      const directoryId = await nextDirectory(ctx, undefined);
      return directoryId === undefined
        ? { stage: "prune" }
        : { stage: "users", directoryId };
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
      return directoryId === undefined
        ? { stage: "prune" }
        : { stage: "users", directoryId };
    }
  }
}

/** Write one listed page, and say where reconcile goes next. */
export const page = internalMutation({
  args: {
    generation: v.number(),
    position: vBackfillPosition,
    updates: v.array(vUpdate),
    after: v.optional(v.string()),
  },
  returns: vStep,
  handler: async (ctx, args) => {
    const copy = await mirror(ctx, args.generation);
    for (const update of args.updates) await copy.write(update);
    return args.after !== undefined
      ? { ...args.position, after: args.after }
      : await advance(ctx, args.position);
  },
});

/**
 * Remove up to a batch of the rows stamped before `generation`. Returns
 * whether there may be more.
 */
export const prune = internalMutation({
  args: { generation: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const copy = await mirror(ctx, args.generation);
    const db = ctx.db;
    const members = await db
      .query("directoryMembers")
      .withIndex("generation", (q) => q.lt("generation", args.generation))
      .take(BATCH);
    for (const member of members) await copy.removeMember(member);
    if (members.length > 0) return true;
    const users = await db
      .query("directoryUsers")
      .withIndex("generation", (q) => q.lt("generation", args.generation))
      .take(BATCH);
    for (const user of users) await copy.removeUser(user);
    if (users.length > 0) return true;
    const groups = await db
      .query("directoryGroups")
      .withIndex("generation", (q) => q.lt("generation", args.generation))
      .take(BATCH);
    for (const group of groups) await copy.removeGroup(group);
    if (groups.length > 0) return true;
    const directories = await db
      .query("directories")
      .withIndex("generation", (q) => q.lt("generation", args.generation))
      .take(BATCH);
    for (const directory of directories) {
      await copy.write({
        kind: "directory",
        row: directoryOf(directory),
        updatedAt: directory.updatedAt,
        deleted: true,
      });
    }
    if (directories.length > 0) return true;
    const connections = await db
      .query("connections")
      .withIndex("generation", (q) => q.lt("generation", args.generation))
      .take(BATCH);
    for (const connection of connections) {
      await copy.removeConnection(connection);
    }
    if (connections.length > 0) return true;
    const domains = await db
      .query("domains")
      .withIndex("generation", (q) => q.lt("generation", args.generation))
      .take(BATCH);
    for (const domain of domains) await copy.removeDomain(domain);
    if (domains.length > 0) return true;
    const organizations = await db
      .query("organizations")
      .withIndex("generation", (q) => q.lt("generation", args.generation))
      .take(BATCH);
    for (const organization of organizations) {
      await copy.removeOrganization(organization);
    }
    return organizations.length > 0;
  },
});

async function removeContents(
  ctx: MutationCtx,
  copy: Mirror,
  directory: Doc<"directories">,
): Promise<boolean> {
  const db = ctx.db;
  const members = await db
    .query("directoryMembers")
    .withIndex("directoryId", (q) => q.eq("directoryId", directory.id))
    .take(BATCH);
  for (const member of members) await copy.removeMember(member);
  if (members.length > 0) return true;
  const users = await db
    .query("directoryUsers")
    .withIndex("directoryId", (q) => q.eq("directoryId", directory.id))
    .take(BATCH);
  for (const user of users) await copy.removeUser(user);
  if (users.length > 0) return true;
  const groups = await db
    .query("directoryGroups")
    .withIndex("directoryId_id", (q) => q.eq("directoryId", directory.id))
    .take(BATCH);
  for (const group of groups) await copy.removeGroup(group);
  return groups.length > 0;
}

/**
 * Remove a batch of the contents of a directory WorkOS deleted, and the
 * directory once it is empty, then queue the next batch.
 */
export const sweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const directory = await ctx.db
      .query("directories")
      .withIndex("deleted", (q) => q.eq("deleted", true))
      .first();
    if (directory === null) return null;
    const copy = await mirror(ctx, Date.now());
    if (!(await removeContents(ctx, copy, directory))) {
      await copy.removeDirectory(directory);
    }
    await ctx.scheduler.runAfter(0, internal.reconcile.sweep, {});
    return null;
  },
});

function listing(position: BackfillPosition) {
  const query = { limit: String(PAGE_SIZE), after: position.after };
  switch (position.stage) {
    case "organizations":
      return { path: "/organizations", query };
    case "connections":
      return { path: "/connections", query };
    case "directories":
      return { path: "/directories", query };
    case "users":
      return {
        path: "/directory_users",
        query: { ...query, directory: position.directoryId },
      };
    case "groups":
      return {
        path: "/directory_groups",
        query: { ...query, directory: position.directoryId },
      };
    case "members":
      return {
        path: "/directory_users",
        query: { ...query, group: position.groupId },
      };
  }
}

/** Run reconcile from `step` for up to a budget of pages, then hand over. */
export const run = internalAction({
  args: { generation: v.number(), step: vStep },
  returns: v.null(),
  handler: async (ctx, args) => {
    let step: BackfillPosition | { stage: "prune" } = args.step;
    for (let pages = 0; pages < PAGES_PER_RUN; pages += 1) {
      if (step.stage === "prune") {
        const more: boolean = await ctx.runMutation(internal.reconcile.prune, {
          generation: args.generation,
        });
        if (!more) return null;
        continue;
      }
      const position: BackfillPosition = step;
      const reply = await callWorkos(env.CLIENT_SECRET, {
        method: "GET",
        ...listing(position),
      });
      const listed = decodeList(reply.body);
      const updates = listed.items.map((item) =>
        position.stage === "members"
          ? decodeMember(item, position.groupId)
          : decodeListed(position.stage, item),
      );
      step = await ctx.runMutation(internal.reconcile.page, {
        generation: args.generation,
        position,
        updates,
        after: listed.after,
      });
    }
    await ctx.scheduler.runAfter(0, internal.reconcile.run, {
      generation: args.generation,
      step,
    });
    return null;
  },
});
