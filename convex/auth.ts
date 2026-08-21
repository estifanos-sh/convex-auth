import { Resend } from "@convex-dev/resend";
import type { AnyDataModel, GenericActionCtx } from "convex/server";
import { defineAuth } from "@estifanos-sh/convex-auth/server";
import {
  anonymous,
  device,
  email,
  google,
  webauthn,
  password,
  connection,
  totp,
} from "@estifanos-sh/convex-auth/providers";

import { components } from "./_generated/api";
import { env } from "./_generated/server";
import { permissions } from "./roles";

function maybeGoogleProvider() {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }
  return google({ clientId, clientSecret });
}

const resend = new Resend(components.resend, {
  testMode: false,
});

/**
 * Context shape that {@link Resend.sendEmailManually} expects for its first
 * argument, derived from the method's own public signature so it tracks any
 * upstream change in `@convex-dev/resend`.
 */
type ResendSendCtx = Parameters<typeof resend.sendEmailManually>[0];

/**
 * Adapt the email provider's action `ctx` to the `ctx` resend wants.
 *
 * Resend types its `runMutation` after the *mutation* runtime, whose signature
 * permits a trailing `{ transactionLimits }` options argument. An action's
 * `runMutation` accepts no such option, so the two `runMutation` types are not
 * mutually assignable even though the action ctx is a fully capable caller at
 * runtime (resend never passes `transactionLimits`). The mismatch is therefore
 * an irreducible cross-package boundary; we isolate it to this single narrow,
 * member-level assertion rather than asserting the whole ctx.
 */
function asResendSendCtx(ctx: GenericActionCtx<AnyDataModel>): ResendSendCtx {
  return { runMutation: ctx.runMutation.bind(ctx) as ResendSendCtx["runMutation"] };
}

const emailProvider = email({
  from: "My App <onboarding@resend.dev>",
  send: async (ctx, params) => {
    await resend.sendEmailManually(
      asResendSendCtx(ctx),
      {
        from: params.from,
        to: params.to,
        subject: params.subject,
      },
      async () => {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: params.from,
            to: params.to,
            subject: params.subject,
            html: params.html,
          }),
        });
        if (!res.ok) {
          throw new Error(`Email send failed: ${res.status}`);
        }
        const payload = (await res.json()) as { id?: string };
        return payload.id ?? "sent";
      },
    );
  },
});

const passkeyProvider = webauthn();
const passwordProvider = password({
  reset: emailProvider,
  afterReset: passkeyProvider.rotate(),
});
const verifiedPasswordProvider = password({
  id: "password-verified",
  verify: emailProvider,
});

const googleProvider = maybeGoogleProvider();
const auth = defineAuth(components.auth, {
  providers: [
    connection(),
    ...(googleProvider ? [googleProvider] : []),
    passwordProvider,
    verifiedPasswordProvider,
    passkeyProvider,
    totp({ issuer: "ConvexAuth Example" }),
    anonymous(),
    device({
      verificationUri: env.APP_URL
        ? `${env.APP_URL.replace(/\/$/, "")}/demo/device`
        : "http://localhost:3001/demo/device",
    }),
    emailProvider,
  ],
  session: {
    get inactiveDurationMs() {
      return env.SESSION_INACTIVE_DURATION_MS
        ? Number(env.SESSION_INACTIVE_DURATION_MS)
        : undefined;
    },
    get totalDurationMs() {
      return env.SESSION_TOTAL_DURATION_MS ? Number(env.SESSION_TOTAL_DURATION_MS) : undefined;
    },
  },
  permissions,
  oauth: {
    pages: { login: "/demo/sign-in", consent: "/demo/oauth/authorize" },
  },
});

export { auth };
export const { signIn, signOut, store } = auth;
