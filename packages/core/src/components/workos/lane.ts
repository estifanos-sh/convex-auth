/**
 * The directory sync's lane.
 *
 * @module
 */
import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api.ts";

/**
 * One serial lane runs every pass over the event stream and every backfill
 * step. WorkOS asks for in-order processing per organization, and a backfill
 * can never race the stream on a row.
 */
export const lane = new Workpool(components.lane, {
  maxParallelism: 1,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 5, initialBackoffMs: 1000, base: 2 },
});

/**
 * How many WorkOS objects one page holds. One page is one mutation, and every
 * row in it may call an app handler in that transaction. At 25, a page of
 * handlers that each do constant work stays well inside a mutation's read and
 * write limits, even when each change also lands its row, its domains or a
 * cascade's backfill row.
 */
export const PAGE_SIZE = 25;
