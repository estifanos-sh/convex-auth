import { defineAuth } from "@estifanos-sh/convex-auth/server";
import { anonymous } from "@estifanos-sh/convex-auth/providers/anonymous";
import { connection } from "@estifanos-sh/convex-auth/providers/connection";
import { device } from "@estifanos-sh/convex-auth/providers/device";
import { email } from "@estifanos-sh/convex-auth/providers/email";
import { google } from "@estifanos-sh/convex-auth/providers/google";
import { password } from "@estifanos-sh/convex-auth/providers/password";
import { totp } from "@estifanos-sh/convex-auth/providers/totp";
import { webauthn } from "@estifanos-sh/convex-auth/providers/webauthn";

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
