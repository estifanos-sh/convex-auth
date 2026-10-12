/**
 * How the lane's jobs fail, and what each failure leaves behind.
 *
 * @module
 */
import { ConvexError, type Infer, v } from "convex/values";
import { ApiError } from "./workosApi.ts";
import { internal } from "./_generated/api.ts";
import type { ActionCtx } from "./_generated/server.ts";
import type { Credentials } from "./credentials.ts";
import { DecodeError, matches } from "./wire.ts";

export const vThrown = v.object({
  code: v.literal("CALLBACK_FAILED"),
  message: v.string(),
  status: v.number(),
  event: v.optional(v.string()),
});
export type Thrown = Infer<typeof vThrown>;

export function thrown(error: unknown, event?: string): ConvexError<Thrown> {
  return new ConvexError({
    code: "CALLBACK_FAILED",
    message: error instanceof Error ? error.message : String(error),
    status: 500,
    event,
  });
}

// Classifies a failed lane job once. What is recorded ends the job unretried, so the next sweep's
// pass, and the drive a caught-up pass ends with, start the work again; what is rethrown is transient and
// goes to the lane's backoff. The returned flag says the cursor expired and the caller owns the
// restart.
export async function recover(
  ctx: ActionCtx,
  error: unknown,
  secrets: Credentials,
): Promise<boolean> {
  if (error instanceof ApiError && error.fault === "credentials") {
    await ctx.runMutation(internal.stream.fail, {
      kind: "credentials",
      key: await secrets.fingerprint(),
      detail: error.message,
    });
    return false;
  }
  if (error instanceof ApiError && error.fault === "expired") return true;
  if (error instanceof ApiError && error.fault === "rejected") {
    await ctx.runMutation(internal.stream.fail, {
      kind: "rejected",
      detail: error.message,
    });
    return false;
  }
  if (error instanceof DecodeError) {
    await ctx.runMutation(internal.stream.fail, {
      kind: "decode",
      detail: error.message,
    });
    return false;
  }
  if (error instanceof ConvexError && matches(vThrown, error.data)) {
    await ctx.runMutation(internal.stream.fail, {
      kind: "callback",
      event: error.data.event,
      detail: error.data.message,
    });
    return false;
  }
  throw error;
}
