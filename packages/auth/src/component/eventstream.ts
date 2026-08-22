/**
 * Component-internal durable ordering for auth events.
 *
 * Stream cursors and protocol types remain private. `AuthEventProjection`
 * remains the component's public read model.
 */

import { defineStream, type StreamHandle } from "@convex-dev/stream/server";
import { type Infer, v } from "convex/values";

import type { MutationCtx, QueryCtx } from "./_generated/server";
import { vAuthEvent } from "./model";

const AUTH_EVENT_STREAM_KEY = "auth-events";
const AUTH_EVENT_STREAM_BUCKET_MS = 24 * 60 * 60 * 1000;
const AUTH_EVENT_STREAM_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

type AuthEventStream = StreamHandle<
  "AuthEventStream",
  typeof vAuthEvent,
  { eventId: ReturnType<typeof v.string> }
>;

export const authEventStream: AuthEventStream = defineStream("AuthEventStream", {
  event: vAuthEvent,
  eventFields: { eventId: v.string() },
  derive: (event) => ({ eventId: event.eventId }),
});

function authEventStreamBucket(now: number) {
  const start = Math.floor(now / AUTH_EVENT_STREAM_BUCKET_MS) * AUTH_EVENT_STREAM_BUCKET_MS;
  return {
    key: `${AUTH_EVENT_STREAM_KEY}:${start}`,
    // Retain every event in this bucket for at least as long as its projection.
    expiresAt: start + AUTH_EVENT_STREAM_BUCKET_MS + AUTH_EVENT_STREAM_RETENTION_MS,
  };
}

/**
 * Append one canonical event to the shared auth-event log exactly once.
 *
 * `eventId` is indexed solely for idempotency. Every kind appends to the
 * current private daily bucket; Stream V6 orders its records by commitTs.
 * Buckets expire with the projection retention window and maintenance closes
 * and deletes them in bounded batches.
 */
export async function appendAuthEvent(ctx: MutationCtx, event: Infer<typeof vAuthEvent>) {
  const existing = await ctx.db
    .query("AuthEventStreamEvents")
    .withIndex("event_id", (q) => q.eq("eventId", event.eventId))
    .unique();
  if (existing !== null) return;

  const stream = await authEventStream.getOrCreate(ctx, authEventStreamBucket(event.occurredAt));
  await authEventStream.append(ctx, {
    streamId: stream.streamId,
    attempt: stream.attempt,
    event,
  });
}

/** Read the current private bucket in commit order without exposing its cursor. */
export async function readOrderedAuthEvents(ctx: QueryCtx, now: number) {
  const stream = await ctx.db
    .query("AuthEventStream")
    .withIndex("by_key", (q) => q.eq("key", authEventStreamBucket(now).key))
    .unique();
  if (stream === null) return [];
  const result = await authEventStream.read(ctx, {
    streamId: stream._id,
    cursor: null,
    numItems: 256,
  });
  return result.page.map(({ event, key }) => ({ kind: event.kind, commitTs: key.commitTs }));
}
