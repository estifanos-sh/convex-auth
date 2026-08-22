/** Internal webhook delivery audit helpers. */

import type { Infer } from "convex/values";

import type { MutationCtx } from "../../_generated/server";
import { appendAuthEventProjection } from "../../event";
import { vAuthEventKind } from "../../model";

export async function appendDeliveryEvent(
  ctx: MutationCtx,
  args: {
    deliveryId: string;
    connectionId: string;
    endpointId: string;
    sourceEventId: string;
    sourceEventType: Infer<typeof vAuthEventKind>;
    kind:
      | "webhook.delivery.created"
      | "webhook.delivery.attempted"
      | "webhook.delivery.succeeded"
      | "webhook.delivery.failed";
    outcome: "success" | "failure";
    occurredAt: number;
    data?: {
      attemptCount?: number;
      status?: number;
      error?: string;
    };
  },
) {
  const attemptPart =
    typeof args.data?.attemptCount === "number" ? `:${args.data.attemptCount}` : "";
  const event = {
    eventId: `${args.kind}:${args.deliveryId}${attemptPart}`,
    kind: args.kind,
    occurredAt: args.occurredAt,
    actor: { type: "webhook" as const, id: args.endpointId },
    subject: { type: "webhook_delivery" as const, id: args.deliveryId },
    targets: [{ kind: "connection" as const, id: args.connectionId }],
    outcome: args.outcome,
    data: {
      sourceEventId: args.sourceEventId,
      sourceEventType: args.sourceEventType,
      endpointId: args.endpointId,
      deliveryId: args.deliveryId,
      ...args.data,
    },
  };
  await appendAuthEventProjection(ctx, { event, targets: event.targets });
}
