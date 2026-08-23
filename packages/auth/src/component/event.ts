/**
 * `component.event.*` - durable, queryable auth-event projections.
 *
 * @module
 */

import { paginator } from "convex-helpers/server/pagination";
import { paginationOptsValidator } from "convex/server";
import { v, type Infer } from "convex/values";

import { ErrorCode } from "../shared/codes";
import { convexError } from "../shared/errors";
import { EVENT_KIND_CATEGORY } from "../shared/event/kinds";
import type { MutationCtx } from "./_generated/server";
import { vAuthEventProjectionDoc } from "./documents";
import { appendAuthEvent, readOrderedAuthEvents } from "./eventstream";
import { internalQuery, mutation, query } from "./_generated/server";
import {
  vAuthEvent,
  vAuthEventInput,
  vAuthEventKind,
  vAuthEventTarget,
  vAuthEventWhere,
  vPaginated,
  vSortOrder,
} from "./model";
import schema from "./schema";

type AuthEvent = Infer<typeof vAuthEvent>;
type AuthEventInput = Infer<typeof vAuthEventInput>;
type AuthEventTarget = Infer<typeof vAuthEventTarget>;
type AuthEventWhere = Infer<typeof vAuthEventWhere>;

const MAX_EVENT_TARGETS = 64;

/** Read the current private auth event stream bucket in commit order for component tests. */
export const orderedEvents = internalQuery({
  args: { now: v.number() },
  returns: v.array(v.object({ kind: vAuthEventKind, commitTs: v.int64() })),
  handler: async (ctx, { now }) => await readOrderedAuthEvents(ctx, now),
});

function targetKey(target: AuthEventTarget): string {
  return `${target.kind}:${target.id}`;
}

function lowerBound(where: AuthEventWhere) {
  if (where.occurredAtGt !== undefined) return { op: "gt" as const, value: where.occurredAtGt };
  if (where.occurredAtGte !== undefined) return { op: "gte" as const, value: where.occurredAtGte };
  return null;
}

function upperBound(where: AuthEventWhere) {
  if (where.occurredAtLt !== undefined) return { op: "lt" as const, value: where.occurredAtLt };
  if (where.occurredAtLte !== undefined) return { op: "lte" as const, value: where.occurredAtLte };
  return null;
}

function applyTimeBounds(q: any, where: AuthEventWhere) {
  const lower = lowerBound(where);
  const upper = upperBound(where);
  if (lower?.op === "gt") q = q.gt("occurredAt", lower.value);
  if (lower?.op === "gte") q = q.gte("occurredAt", lower.value);
  if (upper?.op === "lt") q = q.lt("occurredAt", upper.value);
  if (upper?.op === "lte") q = q.lte("occurredAt", upper.value);
  return q;
}

function projectionQuery(ctx: any, where: AuthEventWhere) {
  const selectors = [
    where.target !== undefined ? "target" : null,
    where.kind !== undefined ? "kind" : null,
    where.category !== undefined ? "category" : null,
    where.outcome !== undefined ? "outcome" : null,
    where.actor !== undefined ? "actor" : null,
    where.subject !== undefined ? "subject" : null,
    where.requestId !== undefined ? "requestId" : null,
  ].filter((value): value is string => value !== null);
  const supported =
    selectors.length === 1 ||
    (where.target !== undefined &&
      selectors.every(
        (selector) => selector === "target" || selector === "kind" || selector === "outcome",
      ));
  if (!supported) {
    throw convexError(
      ErrorCode.INVALID_PARAMETERS,
      "event.list filters must match an event projection index: target, target+kind, target+outcome, target+kind+outcome, or one of kind/category/outcome/actor/subject/requestId.",
    );
  }
  const db = paginator(ctx, schema).query("AuthEventProjection");
  if (where.target !== undefined) {
    if (where.kind !== undefined && where.outcome !== undefined) {
      return db.withIndex("target_kind_outcome_time", (q) =>
        applyTimeBounds(
          q
            .eq("targetKind", where.target!.kind)
            .eq("targetId", where.target!.id)
            .eq("kind", where.kind!)
            .eq("outcome", where.outcome!),
          where,
        ),
      );
    }
    if (where.kind !== undefined) {
      return db.withIndex("target_kind_time", (q) =>
        applyTimeBounds(
          q
            .eq("targetKind", where.target!.kind)
            .eq("targetId", where.target!.id)
            .eq("kind", where.kind!),
          where,
        ),
      );
    }
    if (where.outcome !== undefined) {
      return db.withIndex("target_outcome_time", (q) =>
        applyTimeBounds(
          q
            .eq("targetKind", where.target!.kind)
            .eq("targetId", where.target!.id)
            .eq("outcome", where.outcome!),
          where,
        ),
      );
    }
    return db.withIndex("target_time", (q) =>
      applyTimeBounds(
        q.eq("targetKind", where.target!.kind).eq("targetId", where.target!.id),
        where,
      ),
    );
  }
  if (where.kind !== undefined) {
    return db.withIndex("kind_time", (q) => applyTimeBounds(q.eq("kind", where.kind!), where));
  }
  if (where.category !== undefined) {
    return db.withIndex("category_time", (q) =>
      applyTimeBounds(q.eq("category", where.category!), where),
    );
  }
  if (where.outcome !== undefined) {
    return db.withIndex("outcome_time", (q) =>
      applyTimeBounds(q.eq("outcome", where.outcome!), where),
    );
  }
  if (where.actor !== undefined) {
    return db.withIndex("actor_time", (q) =>
      applyTimeBounds(q.eq("actorType", where.actor!.type).eq("actorId", where.actor!.id), where),
    );
  }
  if (where.subject !== undefined) {
    return db.withIndex("subject_time", (q) =>
      applyTimeBounds(
        q.eq("subjectType", where.subject!.type).eq("subjectId", where.subject!.id),
        where,
      ),
    );
  }
  if (where.requestId !== undefined) {
    return db.withIndex("request_id_time", (q) =>
      applyTimeBounds(q.eq("requestId", where.requestId!), where),
    );
  }
  throw convexError(
    ErrorCode.INVALID_PARAMETERS,
    "event.list requires an indexed filter: target, kind, category, outcome, actor, subject, or requestId.",
  );
}

/** Read a single event projection by id, redacted to its public shape. */
export const get = query({
  args: { id: schema.id("AuthEventProjection") },
  returns: v.union(vAuthEventProjectionDoc, v.null()),
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.get("AuthEventProjection", id);
    return doc;
  },
});

/**
 * Page over event projections matching an indexed `where` selector.
 * Requires a filter that maps to a projection index (target, target+kind,
 * target+outcome, target+kind+outcome, or one of
 * kind/category/outcome/actor/subject/requestId); throws otherwise. Defaults
 * to `desc` order. Rows are returned in their redacted public shape.
 */
export const list = query({
  args: {
    where: vAuthEventWhere,
    order: v.optional(vSortOrder),
    paginationOpts: paginationOptsValidator,
  },
  returns: vPaginated(vAuthEventProjectionDoc),
  handler: async (ctx, { where, order, paginationOpts }) => {
    const result = await projectionQuery(ctx.db, where)
      .order(order ?? "desc")
      .paginate(paginationOpts);
    return {
      ...result,
      page: result.page,
    };
  },
});

/**
 * Append an auth event, fanning out idempotent projections per target.
 *
 * The projection row is the query surface. The canonical event itself is also
 * appended once to the component-private shared stream, whose V6 commitTs
 * ordering is used for durable event ordering. `eventId` makes both writes
 * idempotent.
 */
const vAppendResult = v.object({
  eventId: v.string(),
  created: v.boolean(),
  createdTargets: v.array(vAuthEventTarget),
  projections: v.array(vAuthEventProjectionDoc),
});

/**
 * Append a canonical event and its query projections in the caller's
 * transaction. This is intentionally shared by webhook delivery state
 * transitions so a committed transition can never lack its audit record.
 *
 * @internal
 */
export async function appendAuthEventProjection(
  ctx: MutationCtx,
  args: {
    event: AuthEventInput;
    targets?: AuthEventTarget[];
  },
): Promise<Infer<typeof vAppendResult>> {
  const event: AuthEvent = {
    ...args.event,
    category: EVENT_KIND_CATEGORY[args.event.kind],
  };
  const scopes = args.targets ?? args.event.targets;
  if (scopes.length > MAX_EVENT_TARGETS) {
    throw convexError(
      ErrorCode.INVALID_PARAMETERS,
      `Auth events support at most ${MAX_EVENT_TARGETS} targets`,
    );
  }
  const seenScopes = new Set<string>();
  const createdTargets: AuthEventTarget[] = [];
  const projections: Array<Infer<typeof vAuthEventProjectionDoc>> = [];
  for (const target of scopes) {
    const key = targetKey(target);
    if (seenScopes.has(key)) continue;
    seenScopes.add(key);
    const existing = await ctx.db
      .query("AuthEventProjection")
      .withIndex("event_id_target", (q) =>
        q.eq("eventId", event.eventId).eq("targetKind", target.kind).eq("targetId", target.id),
      )
      .unique();
    if (existing !== null) {
      projections.push(existing);
      continue;
    }

    const projectionId = await ctx.db.insert("AuthEventProjection", {
      eventId: event.eventId,
      targetKind: target.kind,
      targetId: target.id,
      kind: event.kind,
      category: event.category,
      occurredAt: event.occurredAt,
      actorType: event.actor.type,
      actorId: event.actor.id,
      subjectType: event.subject.type,
      subjectId: event.subject.id,
      outcome: event.outcome,
      errorCode: event.errorCode,
      requestId: event.request?.requestId,
      ip: event.request?.ip,
      userAgent: event.request?.userAgent,
      data: event.data,
    });
    const projection = await ctx.db.get("AuthEventProjection", projectionId);
    if (projection !== null) projections.push(projection);
    createdTargets.push(target);
  }
  await appendAuthEvent(ctx, event);
  return {
    eventId: event.eventId,
    created: createdTargets.length > 0,
    createdTargets,
    projections,
  };
}

export const append = mutation({
  args: {
    event: vAuthEventInput,
    targets: v.optional(v.array(vAuthEventTarget)),
  },
  returns: vAppendResult,
  handler: async (ctx, args) => await appendAuthEventProjection(ctx, args),
});
