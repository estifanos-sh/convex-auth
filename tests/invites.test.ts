import { api, components } from "@convex/_generated/api";
import type { DataModel } from "@convex/_generated/dataModel";
import { auth as backendAuth } from "@convex/auth";
import schema from "@convex/schema";
import { client } from "@estifanos-sh/convex-auth/client";
import type { FunctionArgs } from "convex/server";
import { decodeJwt } from "jose";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { convexTest, type TestConvexForDataModel } from "./convex/setup";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("token invite acceptance allows matching unverified email", async () => {
  const t = convexTest(schema);
  const inviteEmail = "invited@example.com";

  const signUpResult = await t.action(api.auth.signIn, {
    request: {
      provider: "password",
      params: {
        email: inviteEmail,
        password: "44448888",
        flow: "signUp",
      },
    },
  });
  expect(signUpResult.kind).toBe("signedIn");
  if (signUpResult.kind !== "signedIn") {
    throw new Error("Expected password signUp to return an immediate session");
  }

  const claims = decodeJwt(signUpResult.session!.token);
  const token = "invite-token-unverified";
  const inviteId = await createInvite(t, {
    token,
    email: inviteEmail,
  });

  const result = await t
    .withIdentity({ subject: claims.sub!, sid: "invite-1" as any })
    .run(async (ctx) => {
      return await backendAuth.invite.token.accept(ctx as any, {
        token,
      });
    });

  expect(result.inviteId).toBe(inviteId);
  expect(result.inviteStatus).toBe("accepted");
  expect(result.membershipStatus).toBe("not_applicable");

  const invite = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.group.invite.get, { id: inviteId });
  });
  expect(invite?.status).toBe("accepted");
  expect(invite?.acceptedByUserId).toBeDefined();
});

test("token invite acceptance still rejects mismatched email", async () => {
  const t = convexTest(schema);

  const signUpResult = await t.action(api.auth.signIn, {
    request: {
      provider: "password",
      params: {
        email: "different@example.com",
        password: "44448888",
        flow: "signUp",
      },
    },
  });
  expect(signUpResult.kind).toBe("signedIn");
  if (signUpResult.kind !== "signedIn") {
    throw new Error("Expected password signUp to return an immediate session");
  }

  const claims = decodeJwt(signUpResult.session!.token);
  const token = "invite-token-mismatch";
  await createInvite(t, {
    token,
    email: "invited@example.com",
  });

  await expect(async () => {
    await t.withIdentity({ subject: claims.sub!, sid: "invite-2" as any }).run(async (ctx) => {
      return await backendAuth.invite.token.accept(ctx as any, {
        token,
      });
    });
  }).rejects.toThrow("Invite email does not match accepting user's email");
});

test("proxy sign up can immediately accept invite", async () => {
  const t = convexTest(schema);
  const inviteEmail = "proxy-flow@example.com";
  const inviteToken = "proxy-flow-token";
  await createInvite(t, {
    token: inviteToken,
    email: inviteEmail,
  });

  const convex = createConvexTransportMock();
  const auth = client({
    convex,
    proxyPath: "/api/auth",
    url: "https://example.convex.cloud",
    runtime: {
      proxy: {
        fetch: vi.fn(
          async (payload: {
            action?: string;
            args?: Partial<FunctionArgs<typeof api.auth.signIn>>;
          }) => {
            if (payload.action !== "auth:signIn") {
              return new Response(JSON.stringify({ error: "Unsupported action" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
              });
            }

            if (payload.args?.request !== undefined && "refreshToken" in payload.args.request) {
              return new Response(JSON.stringify({ kind: "signedIn", session: null }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }

            if (payload.args?.request === undefined) {
              return new Response(JSON.stringify({ error: "Missing sign-in request" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
              });
            }

            const result = await t.action(api.auth.signIn, {
              request: payload.args.request,
            });
            return new Response(JSON.stringify(result), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          },
        ),
      },
    },
  });

  const signInPromise = auth.signIn("password", {
    email: inviteEmail,
    password: "44448888",
    flow: "signUp",
  });

  await waitForSetAuthCalls(convex, 2);
  convex.triggerAuthChange(false);
  convex.triggerAuthChange(true);

  const signInResult = await signInPromise;
  expect(signInResult.kind).toBe("signedIn");

  const snapshot = auth.getSnapshot();
  const claims = decodeJwt(snapshot.status === "signedIn" ? snapshot.token : "");
  expect(typeof claims.sub).toBe("string");
  const acceptResult = await t
    .withIdentity({ subject: claims.sub!, sid: "invite-3" as any })
    .run(async (ctx) => {
      return await backendAuth.invite.token.accept(ctx as any, {
        token: inviteToken,
      });
    });
  expect(acceptResult.inviteStatus).toBe("accepted");
  expect(acceptResult.membershipStatus).toBe("not_applicable");

  auth.destroy();
});

function createConvexTransportMock() {
  const authRegistrations: Array<{
    fetchToken: (args: { forceRefreshToken: boolean }) => Promise<string | null | undefined>;
    onChange?: (isAuthenticated: boolean) => void;
  }> = [];

  return {
    action: vi.fn(async () => null),
    setAuth: vi.fn((fetchToken, onChange) => {
      authRegistrations.push({ fetchToken, onChange });
    }),
    clearAuth: vi.fn(),
    triggerAuthChange(isAuthenticated: boolean) {
      authRegistrations[authRegistrations.length - 1]?.onChange?.(isAuthenticated);
    },
    setAuthCallCount() {
      return authRegistrations.length;
    },
  };
}

async function waitForSetAuthCalls(
  convex: ReturnType<typeof createConvexTransportMock>,
  count: number,
) {
  const timeoutAt = Date.now() + 1000;
  while (convex.setAuthCallCount() < count) {
    if (Date.now() > timeoutAt) {
      throw new Error(`Timed out waiting for setAuth calls (${count})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function createInvite(
  t: TestConvexForDataModel<DataModel>,
  args: { token: string; email: string },
) {
  const tokenHash = await sha256Hex(args.token);
  return await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.group.invite.create, {
      tokenHash,
      email: args.email,
      roleIds: ["member"],
    });
  });
}

async function sha256Hex(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
