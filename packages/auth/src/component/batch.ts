import { ConvexError } from "convex/values";

import { ErrorCode } from "../shared/codes";

/** Maximum IDs accepted by a single batched component read. @internal */
export const MAX_BATCH_SELECTOR_SIZE = 100;

/** @internal Reject an oversized batch before it can start database work. */
export function assertBatchSelectorSize(ids: readonly unknown[], selector: string) {
  if (ids.length > MAX_BATCH_SELECTOR_SIZE) {
    throw new ConvexError({
      code: ErrorCode.INVALID_PARAMETERS,
      message: `Batch selector "${selector}" accepts at most ${MAX_BATCH_SELECTOR_SIZE} IDs.`,
    });
  }
}
