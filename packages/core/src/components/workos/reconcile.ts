/**
 * Reconcile: list everything WorkOS holds, write it into the copy, and remove
 * what WorkOS no longer has. It is how a new deployment fills its copy and
 * how deliveries the webhook missed are repaired: WorkOS retries a failed
 * delivery for a few minutes in staging, and for up to 3 days in production.
 *
 * A reconcile that starts at time T stamps every row it lists with T. Each
 * page is fetched in an action and written in one mutation. Once a group's
 * members are listed, its memberships older than T go. Once every listing is
 * done, each row older than T is read again by id, and removed only if WorkOS
 * answers 404, so a reconcile that overlaps another, or a webhook delivery,
 * never removes what WorkOS still has. A run hands over to a fresh action
 * before an action's time limit, and tries the same step again after
 * WorkOS's `Retry-After` when WorkOS sends one.
 *
 * @module
 */
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api.ts";
import type { Doc } from "./_generated/dataModel.ts";
import type { ActionCtx, MutationCtx } from "./_generated/server.ts";
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server.ts";
import { BATCH, PAGE_SIZE } from "./constants.ts";
import { changeHandler, Mirror } from "./mirror.ts";
import { callWorkos, WorkosApiError } from "./rest.ts";
import { type BackfillPosition, vBackfillPosition } from "./schema.ts";
import {
  decodeList,
  decodeListed,
  decodeMember,
  decodeObject,
  type Kind,
  objectPath,
  type Update,
  vKind,
  vUpdate,
} from "./wire.ts";

/** Pages one action applies before it hands over to a fresh one. */
const PAGES_PER_RUN = 100;

/** The order rows older than a reconcile are read again: children first. */
const PRUNED: Kind[] = [
  "user",
  "group",
  "directory",
  "connection",
  "domain",
  "organization",
];

const vTrim = v.object({
  stage: v.literal("trim"),
  directoryId: v.string(),
  groupId: v.string(),
});
const vStep = v.union(
  vBackfillPosition,
  vTrim,
  v.object({ stage: v.literal("prune"), kind: vKind }),
);
type Step = Infer<typeof vStep>;

/** The copy, with the app's handler from the registered webhook. */
async function mirror(ctx: MutationCtx, generation: number): Promise<Mirror> {
  const webhook = await ctx.db.query("webhook").first();
  if (webhook === null) {
    throw new Error("Register the webhook (webhook.register) before this");
  }
  return new Mirror(ctx, generation, changeHandler(webhook.onChange));
}

/**
 * The object as WorkOS holds it now, or null if WorkOS no longer has it.
 */
export async function read(kind: Kind, id: string): Promise<Update | null> {
  try {
    const reply = await callWorkos(env.CLIENT_SECRET, {
      method: "GET",
      path: objectPath(kind, id),
    });
    return decodeObject(kind, reply.body);
  } catch (error) {
    if (error instanceof WorkosApiError && error.status === 404) return null;
    throw error;
  }
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
): Promise<Step> {
  switch (position.stage) {
    case "organizations":
      return { stage: "connections" };
    case "connections":
      return { stage: "directories" };
    case "directories": {
      const directoryId = await nextDirectory(ctx, undefined);
      return directoryId === undefined
        ? { stage: "prune", kind: "user" }
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
        ? { stage: "prune", kind: "user" }
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
    const position = args.position;
    if (args.after !== undefined) return { ...position, after: args.after };
    if (position.stage === "members") {
      return {
        stage: "trim" as const,
        directoryId: position.directoryId,
        groupId: position.groupId,
      };
    }
    return await advance(ctx, position);
  },
});

/**
 * Remove a batch of the group's memberships that no listing since
 * `generation` showed, and say where to go next.
 */
export const trim = internalMutation({
  args: { generation: v.number(), step: vTrim },
  returns: vStep,
  handler: async (ctx, { generation, step }) => {
    const copy = await mirror(ctx, generation);
    const stale = await ctx.db
      .query("directoryMembers")
      .withIndex("groupId_generation", (q) =>
        q.eq("groupId", step.groupId).lt("generation", generation),
      )
      .take(BATCH);
    for (const member of stale) await copy.removeMember(member);
    if (stale.length === BATCH) return step;
    return await advance(ctx, { ...step, stage: "members" });
  },
});

/** Up to a batch of the ids of rows of `kind` older than `generation`. */
export const stale = internalQuery({
  args: { kind: vKind, generation: v.number() },
  returns: v.array(v.string()),
  handler: async (ctx, { kind, generation }) => {
    const table = {
      organization: "organizations",
      domain: "domains",
      connection: "connections",
      directory: "directories",
      user: "directoryUsers",
      group: "directoryGroups",
    } as const;
    const rows = await ctx.db
      .query(table[kind])
      .withIndex("generation", (q) => q.lt("generation", generation))
      .take(BATCH);
    return rows.map((row) => row.id);
  },
});

/**
 * Write the objects WorkOS returned, and remove those it answered 404 for.
 * Every row it touches is stamped now.
 */
export const settle = internalMutation({
  args: { kind: vKind, updates: v.array(vUpdate), gone: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const copy = await mirror(ctx, Date.now());
    for (const update of args.updates) await copy.write(update);
    for (const id of args.gone) await copy.remove(args.kind, id);
    return null;
  },
});

/** Remove the next batch of a deleted user's or group's memberships. */
export const drop = internalMutation({
  args: {
    kind: v.union(v.literal("user"), v.literal("group")),
    id: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const copy = await mirror(ctx, Date.now());
    await copy.remove(args.kind, args.id);
    return null;
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

/** Take one step: a page, a trim batch or a batch of reads by id. */
async function take(
  ctx: ActionCtx,
  generation: number,
  step: Step,
): Promise<Step | null> {
  if (step.stage === "trim") {
    return await ctx.runMutation(internal.reconcile.trim, { generation, step });
  }
  if (step.stage === "prune") {
    const ids: string[] = await ctx.runQuery(internal.reconcile.stale, {
      kind: step.kind,
      generation,
    });
    if (ids.length === 0) {
      const next = PRUNED[PRUNED.indexOf(step.kind) + 1];
      return next === undefined ? null : { stage: "prune", kind: next };
    }
    const updates: Update[] = [];
    const gone: string[] = [];
    for (const id of ids) {
      const update = await read(step.kind, id);
      if (update === null) gone.push(id);
      else updates.push(update);
    }
    await ctx.runMutation(internal.reconcile.settle, {
      kind: step.kind,
      updates,
      gone,
    });
    return step;
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
  return await ctx.runMutation(internal.reconcile.page, {
    generation,
    position,
    updates,
    after: listed.after,
  });
}

/**
 * Take steps from `step` while `more` holds, for up to a budget of steps.
 * Returns the step to continue from, if any, and how long to wait first:
 * when WorkOS refuses with a `Retry-After`, the same step goes again once it
 * has passed. Any other failure ends the run, and the next delivery, which
 * WorkOS retries, or the next deploy's reconcile drives the work again.
 */
async function walk(
  ctx: ActionCtx,
  generation: number,
  step: Step,
  more: (step: Step) => boolean,
): Promise<{ next: Step; pause: number } | null> {
  let current: Step | null = step;
  for (let taken = 0; taken < PAGES_PER_RUN; taken += 1) {
    if (current === null || !more(current)) return null;
    const at: Step = current;
    try {
      current = await take(ctx, generation, at);
    } catch (error) {
      if (
        error instanceof WorkosApiError &&
        error.retryable &&
        error.retryAfterMs !== undefined
      ) {
        return { next: at, pause: error.retryAfterMs };
      }
      throw error;
    }
  }
  return current !== null && more(current) ? { next: current, pause: 0 } : null;
}

/** Run reconcile from `step`, handing over to a fresh action as it goes. */
export const run = internalAction({
  args: { generation: v.number(), step: vStep },
  returns: v.null(),
  handler: async (ctx, args) => {
    const left = await walk(ctx, args.generation, args.step, () => true);
    if (left !== null) {
      await ctx.scheduler.runAfter(left.pause, internal.reconcile.run, {
        generation: args.generation,
        step: left.next,
      });
    }
    return null;
  },
});

const vGroupStep = v.union(
  vTrim,
  v.object({
    stage: v.literal("members"),
    directoryId: v.string(),
    groupId: v.string(),
    after: v.optional(v.string()),
  }),
);

/**
 * List one group's members as WorkOS holds them now, and remove the
 * memberships the listing did not show. A membership delivery runs this:
 * WorkOS reads memberships back only as a group's member list.
 */
export const members = internalAction({
  args: { generation: v.number(), step: vGroupStep },
  returns: v.null(),
  handler: async (ctx, args) => {
    const group = args.step.groupId;
    const left = await walk(
      ctx,
      args.generation,
      args.step,
      (step) =>
        (step.stage === "members" || step.stage === "trim") &&
        step.groupId === group,
    );
    if (
      left !== null &&
      (left.next.stage === "members" || left.next.stage === "trim")
    ) {
      await ctx.scheduler.runAfter(left.pause, internal.reconcile.members, {
        generation: args.generation,
        step: left.next,
      });
    }
    return null;
  },
});
