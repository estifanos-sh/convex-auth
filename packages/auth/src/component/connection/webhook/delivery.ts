/**
 * `component.connection.webhook.delivery.*` — queued webhook delivery attempts
 * (sub-resource of webhook).
 *
 * `list` is overloaded (`{ connectionId }` history or
 * `{ now }` ready-for-dispatch).
 *
 * @module
 */

import { Workpool, vOnCompleteArgs } from "@convex-dev/workpool";
import { paginationOptsValidator } from "convex/server";
import { v, type Infer } from "convex/values";
import { paginator } from "convex-helpers/server/pagination";

import { api, components, internal } from "../../_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query } from "../../functions";
import { unsafeFetchUrlReason } from "../../../shared/fetch/guard";
import {
  vAuthEventKind,
  vGroupWebhookDeliveryDoc,
  vGroupWebhookDeliveryPublicDoc,
  vPaginated,
} from "../../model";
import schema from "../../schema";
import { appendDeliveryEvent } from "./events";

const MAX_ATTEMPTS = 5;

const workpool = new Workpool(components.webhookWorkpool, {
  maxParallelism: 5,
  defaultRetryBehavior: { maxAttempts: MAX_ATTEMPTS, initialBackoffMs: 1_000, base: 2 },
  retryActionsByDefault: true,
});

/**
 * Whether an HTTP response status warrants a retry. Only transient failures
 * retry — `5xx`, `408 Request Timeout`, and `429 Too Many Requests`. Every
 * other non-2xx (the rest of `4xx`, plus unfollowed `3xx`) is a permanent
 * rejection that re-sending the identical payload cannot fix, so it fails
 * immediately instead of burning the full retry budget.
 */
function isRetriableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

function publicDelivery(
  delivery: Infer<typeof vGroupWebhookDeliveryDoc>,
): Infer<typeof vGroupWebhookDeliveryPublicDoc> {
  return {
    _id: delivery._id,
    _creationTime: delivery._creationTime,
    connectionId: delivery.connectionId,
    endpointId: delivery.endpointId,
    eventId: delivery.eventId,
    kind: delivery.kind,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    nextAttemptAt: delivery.nextAttemptAt,
    lastAttemptAt: delivery.lastAttemptAt,
    lastResponseStatus: delivery.lastResponseStatus,
    lastError: delivery.lastError,
    signedAt: delivery.signedAt,
  };
}

/** Read a delivery by id (internal — returns the full, unredacted doc). */
export const get = internalQuery({
  args: { id: v.id("GroupWebhookDelivery") },
  returns: v.union(vGroupWebhookDeliveryDoc, v.null()),
  handler: async (ctx, { id: deliveryId }) => {
    return await ctx.db.get("GroupWebhookDelivery", deliveryId);
  },
});

/** List a connection's deliveries, newest first and paginated. Rows are redacted to public fields. */
export const list = query({
  args: {
    connectionId: v.id("GroupConnection"),
    paginationOpts: paginationOptsValidator,
  },
  returns: vPaginated(vGroupWebhookDeliveryPublicDoc),
  handler: async (ctx, { connectionId, paginationOpts }) => {
    const result = await paginator(ctx.db, schema)
      .query("GroupWebhookDelivery")
      .withIndex("group_connection_id", (idx) => idx.eq("connectionId", connectionId))
      .order("desc")
      .paginate(paginationOpts);
    return {
      ...result,
      page: result.page.map(publicDelivery),
    };
  },
});

/**
 * List pending deliveries whose `nextAttemptAt` is at or before `now`, ready to
 * be dispatched (`limit` clamped to 1..100, default 50).
 */
export const dueForDispatch = query({
  args: {
    now: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.array(vGroupWebhookDeliveryDoc),
  handler: async (ctx, { now, limit }) => {
    const take = Math.min(Math.max(limit ?? 50, 1), 100);
    return await ctx.db
      .query("GroupWebhookDelivery")
      .withIndex("status_next_attempt_at", (idx) =>
        idx.eq("status", "pending").lte("nextAttemptAt", now),
      )
      .take(take);
  },
});

/** Mark a pending delivery as in progress and record its attempt atomically. */
export const begin = internalMutation({
  args: { id: v.id("GroupWebhookDelivery"), occurredAt: v.number() },
  returns: v.union(vGroupWebhookDeliveryDoc, v.null()),
  handler: async (ctx, { id: deliveryId, occurredAt }) => {
    const delivery = await ctx.db.get("GroupWebhookDelivery", deliveryId);
    if (delivery === null || delivery.status !== "pending") return null;

    const attemptCount = delivery.attemptCount + 1;
    await ctx.db.patch("GroupWebhookDelivery", deliveryId, {
      status: "processing",
      attemptCount,
      lastAttemptAt: occurredAt,
    });
    await appendDeliveryEvent(ctx, {
      deliveryId,
      connectionId: delivery.connectionId,
      endpointId: delivery.endpointId,
      sourceEventId: delivery.eventId,
      sourceEventType: delivery.kind,
      kind: "webhook.delivery.attempted",
      outcome: "success",
      occurredAt,
      data: { attemptCount },
    });
    return {
      ...delivery,
      status: "processing" as const,
      attemptCount,
      lastAttemptAt: occurredAt,
    };
  },
});

/** Settle an in-progress delivery and record its outcome atomically. */
export const settle = internalMutation({
  args: {
    id: v.id("GroupWebhookDelivery"),
    occurredAt: v.number(),
    outcome: v.union(v.literal("success"), v.literal("failure")),
    retry: v.boolean(),
    responseStatus: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get("GroupWebhookDelivery", args.id);
    if (delivery === null || delivery.status !== "processing") return null;

    const succeeded = args.outcome === "success";
    await ctx.db.patch("GroupWebhookDelivery", args.id, {
      status: succeeded ? "delivered" : args.retry ? "pending" : "failed",
      nextAttemptAt: args.retry ? args.occurredAt : delivery.nextAttemptAt,
      lastAttemptAt: args.occurredAt,
      lastResponseStatus: args.responseStatus,
      lastError: args.error,
    });
    await appendDeliveryEvent(ctx, {
      deliveryId: args.id,
      connectionId: delivery.connectionId,
      endpointId: delivery.endpointId,
      sourceEventId: delivery.eventId,
      sourceEventType: delivery.kind,
      kind: succeeded ? "webhook.delivery.succeeded" : "webhook.delivery.failed",
      outcome: args.outcome,
      occurredAt: args.occurredAt,
      data: {
        attemptCount: delivery.attemptCount,
        status: args.responseStatus,
        error: args.error,
      },
    });
    return null;
  },
});

/**
 * Queue a delivery for an endpoint. Idempotent on `(eventId, endpointId)` —
 * returns the existing id if already queued. The row, its audit event, and the
 * durable workpool entry commit together; an audit failure aborts all three.
 */
export const create = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    endpointId: v.id("GroupWebhookEndpoint"),
    eventId: v.string(),
    kind: vAuthEventKind,
    payload: v.any(),
    nextAttemptAt: v.number(),
    signature: v.string(),
    signedAt: v.number(),
  },
  returns: v.id("GroupWebhookDelivery"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("GroupWebhookDelivery")
      .withIndex("event_id_endpoint_id", (idx) =>
        idx.eq("eventId", args.eventId).eq("endpointId", args.endpointId),
      )
      .unique();
    if (existing !== null) return existing._id;
    const deliveryId = await ctx.db.insert("GroupWebhookDelivery", {
      ...args,
      status: "pending",
      attemptCount: 0,
    });
    await appendDeliveryEvent(ctx, {
      deliveryId,
      connectionId: args.connectionId,
      endpointId: args.endpointId,
      sourceEventId: args.eventId,
      sourceEventType: args.kind,
      kind: "webhook.delivery.created",
      outcome: "success",
      occurredAt: args.signedAt,
    });
    await workpool.enqueueAction(
      ctx,
      internal.connection.webhook.delivery.dispatch,
      { id: deliveryId },
      {
        runAt: args.nextAttemptAt,
        onComplete: internal.connection.webhook.delivery.onDispatchComplete,
        context: { deliveryId },
      },
    );
    return deliveryId;
  },
});

/**
 * Workpool completion hook for a delivery's dispatch chain.
 *
 * Guarantees a terminal row state even when `dispatch` itself never reached its
 * own terminal branch — e.g. a bookkeeping mutation threw on every attempt, so
 * the workpool exhausted its retries while the row was left non-terminal. On any
 * non-success outcome, settle a still-open delivery as `failed`.
 */
export const onDispatchComplete = internalMutation({
  args: vOnCompleteArgs(v.object({ deliveryId: v.id("GroupWebhookDelivery") })),
  returns: v.null(),
  handler: async (ctx, { context, result }) => {
    if (result.kind === "success") return null;
    const delivery = await ctx.db.get("GroupWebhookDelivery", context.deliveryId);
    if (delivery === null || delivery.status !== "processing") {
      return null;
    }
    await appendDeliveryEvent(ctx, {
      deliveryId: context.deliveryId,
      connectionId: delivery.connectionId,
      endpointId: delivery.endpointId,
      sourceEventId: delivery.eventId,
      sourceEventType: delivery.kind,
      kind: "webhook.delivery.failed",
      outcome: "failure",
      occurredAt: Date.now(),
      data: {
        attemptCount: delivery.attemptCount,
        error: result.kind === "failed" ? result.error : "delivery canceled",
      },
    });
    await ctx.db.patch("GroupWebhookDelivery", context.deliveryId, {
      status: "failed",
      lastError: result.kind === "failed" ? result.error : "delivery canceled",
    });
    return null;
  },
});

/**
 * POST a delivery's signed payload to its endpoint and settle the row. Skips
 * (failing the delivery) when the endpoint is missing or disabled. Marks
 * `delivered` on a 2xx; on failure, retries via the workpool until the attempt
 * budget is spent — only transient HTTP statuses (see `isRetriableStatus`) and
 * fetch errors are retried, everything else fails immediately. Emits
 * `attempted`/`succeeded`/`failed` audit events along the way.
 */
export const dispatch = internalAction({
  args: { id: v.id("GroupWebhookDelivery") },
  returns: v.null(),
  handler: async (ctx, { id: deliveryId }) => {
    const startedAt = Date.now();
    const delivery = await ctx.runMutation(internal.connection.webhook.delivery.begin, {
      id: deliveryId,
      occurredAt: startedAt,
    });
    if (delivery === null) return null;

    const endpoint = (await ctx.runQuery(api.connection.webhook.endpoint.get, {
      id: delivery.endpointId,
    })) as { url: string; status: string } | null;
    if (!endpoint || endpoint.status !== "active") {
      await ctx.runMutation(internal.connection.webhook.delivery.settle, {
        id: deliveryId,
        occurredAt: startedAt,
        outcome: "failure",
        retry: false,
        error: "endpoint missing or disabled",
      });
      return null;
    }

    const body = JSON.stringify({
      kind: delivery.kind,
      payload: delivery.payload,
    });
    let response: Response;
    try {
      const unsafeUrlReason = unsafeFetchUrlReason(endpoint.url);
      if (unsafeUrlReason !== null) {
        throw new Error(`Webhook ${unsafeUrlReason}`);
      }
      response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Event-Type": delivery.kind,
          "X-Auth-Delivery-Id": delivery._id,
          "X-Auth-Timestamp": String(delivery.signedAt),
          "X-Auth-Signature": `sha256=${delivery.signature}`,
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const retry = delivery.attemptCount < MAX_ATTEMPTS;
      await ctx.runMutation(internal.connection.webhook.delivery.settle, {
        id: deliveryId,
        occurredAt: startedAt,
        outcome: "failure",
        retry,
        error,
      });
      if (retry) throw err;
      return null;
    }

    if (!response.ok) {
      const retry = isRetriableStatus(response.status) && delivery.attemptCount < MAX_ATTEMPTS;
      await ctx.runMutation(internal.connection.webhook.delivery.settle, {
        id: deliveryId,
        occurredAt: startedAt,
        outcome: "failure",
        retry,
        responseStatus: response.status,
        error: `HTTP ${response.status}`,
      });
      if (retry) throw new Error(`Webhook delivery failed: HTTP ${response.status}`);
      return null;
    }

    await ctx.runMutation(internal.connection.webhook.delivery.settle, {
      id: deliveryId,
      occurredAt: startedAt,
      outcome: "success",
      retry: false,
      responseStatus: response.status,
    });
    return null;
  },
});
