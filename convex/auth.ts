import { defineAuth } from "@estifanos-sh/convex-auth/server";
import { anonymous } from "@estifanos-sh/convex-auth/providers/anonymous";
import { connection } from "@estifanos-sh/convex-auth/providers/connection";
import { credentials } from "@estifanos-sh/convex-auth/providers/credentials";
import { device } from "@estifanos-sh/convex-auth/providers/device";
import { email } from "@estifanos-sh/convex-auth/providers/email";
import { google } from "@estifanos-sh/convex-auth/providers/google";
import { password } from "@estifanos-sh/convex-auth/providers/password";
import { totp } from "@estifanos-sh/convex-auth/providers/totp";
import { webauthn } from "@estifanos-sh/convex-auth/providers/webauthn";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { env } from "./_generated/server";
import { sendEmail } from "./email";
import { permissions } from "./roles";

function maybeGoogleProvider() {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }
  return google({ clientId, clientSecret });
}

const emailProvider = email({
  from: "My App <onboarding@resend.dev>",
  send: async (ctx, params) => {
    await sendEmail(ctx, params);
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

/**
 * Preview-style delegating provider: `guest` is reachable only through
 * `preview`'s `extraProviders`, never as a top-level provider, so signing in
 * exercises the extra-provider registration path end to end.
 */
const guestProvider = anonymous({ id: "guest" });
const previewProvider = credentials({
  id: "preview",
  params: v.optional(v.object({ redirectTo: v.optional(v.string()) })),
  authorize: async (params, ctx) => {
    return await ctx.auth.provider.signIn(ctx, {
      provider: guestProvider,
      ...(params === undefined ? {} : { params }),
    });
  },
  extraProviders: [guestProvider],
});

/**
 * A password provider reachable only through `delegate`'s `extraProviders`.
 * Exercises every store mutation that has to resolve a provider id on the far
 * side of `auth:store`: account creation, credentials verification, and the
 * credentials update behind a password change.
 */
const delegatedPasswordProvider = password({ id: "delegated-password" });
const delegateProvider = credentials({
  id: "delegate",
  params: v.union(
    v.object({ flow: v.literal("signUp"), email: v.string(), password: v.string() }),
    v.object({ flow: v.literal("signIn"), email: v.string(), password: v.string() }),
    v.object({ flow: v.literal("check"), email: v.string(), password: v.string() }),
    v.object({
      flow: v.literal("change"),
      email: v.string(),
      currentPassword: v.string(),
      newPassword: v.string(),
    }),
  ),
  authorize: async (params, ctx) => {
    if (params.flow === "check") {
      const existing = await ctx.auth.account.get(ctx, {
        provider: delegatedPasswordProvider.id,
        account: { id: params.email, secret: params.password },
      });
      if (existing === null) {
        return null;
      }
      return { userId: existing.user._id, hasTotp: false };
    }
    return await ctx.auth.provider.signIn(ctx, {
      provider: delegatedPasswordProvider,
      params,
    });
  },
  extraProviders: [delegatedPasswordProvider],
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
    previewProvider,
    delegateProvider,
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
