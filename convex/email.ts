import { Resend } from "@convex-dev/resend";
import { ConvexError } from "convex/values";

import { components } from "./_generated/api";
import { env, type ActionCtx } from "./_generated/server";
import { ErrorCode } from "./errors";

type ResendSendCtx = Parameters<Resend["sendEmail"]>[0];
type EmailCtx = Pick<ActionCtx, "runMutation">;

function asResendSendCtx(ctx: EmailCtx): ResendSendCtx {
  return { runMutation: ctx.runMutation.bind(ctx) as ResendSendCtx["runMutation"] };
}

export type EmailMessage = {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
};

/**
 * Queue email through the durable Resend component when delivery is configured.
 * Missing application credentials disable only email delivery, never deployment.
 */
export async function sendEmail(ctx: EmailCtx, message: EmailMessage): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  if (apiKey === undefined) {
    throw new ConvexError({
      code: ErrorCode.EMAIL_NOT_CONFIGURED,
      message: "Email delivery is not configured for this deployment.",
      status: 503,
    });
  }

  const resend = new Resend(components.resend, { apiKey, testMode: false });
  await resend.sendEmail(asResendSendCtx(ctx), message);
}
