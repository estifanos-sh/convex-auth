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

/**
 * Append one canonical event to the shared auth-event log exactly once.
 *
 * `eventId` is indexed solely for idempotency. Every kind appends to the one
 * private `auth-events` stream; Stream V6 orders those records by commitTs.
 * This helper never completes the stream because the auth event log is
 * intentionally long-lived.
 */
export async function appendAuthEvent(ctx: MutationCtx, event: Infer<typeof vAuthEvent>) {
  const existing = await ctx.db
    .query("AuthEventStreamEvents")
    .withIndex("event_id", (q) => q.eq("eventId", event.eventId))
    .unique();
  if (existing !== null) return;

  const stream = await authEventStream.getOrCreate(ctx, {
    key: AUTH_EVENT_STREAM_KEY,
  });
  await authEventStream.append(ctx, {
    streamId: stream.streamId,
    attempt: stream.attempt,
    event,
  });
}

/** Read the private stream in commit order without exposing its cursor. */
export async function readOrderedAuthEvents(ctx: QueryCtx) {
  const stream = await ctx.db
    .query("AuthEventStream")
    .withIndex("by_key", (q) => q.eq("key", AUTH_EVENT_STREAM_KEY))
    .unique();
  if (stream === null) return [];
  const result = await authEventStream.read(ctx, {
    streamId: stream._id,
    cursor: null,
    numItems: 256,
  });
  return result.page.map(({ event, key }) => ({ kind: event.kind, commitTs: key.commitTs }));
}
