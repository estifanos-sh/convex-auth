import { api } from "@convex/_generated/api";
import schema from "@convex/schema";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { convexTest } from "./convex/setup";
import { expectSignInSession, TEST_EMAIL, TEST_PASSWORD } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
});

test("rate limit on password", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema);

  await t.action(api.auth.signIn, {
    request: {
      provider: "password",
      params: { email: TEST_EMAIL, password: TEST_PASSWORD, flow: "signUp" },
    },
  });

  const SECOND_MS = 1000;
  const MINUTE_MS = SECOND_MS * 60;

  for (let i = 0; i < 10; i++) {
    vi.advanceTimersByTime(10 * SECOND_MS);
    await expect(
      async () =>
        await t.action(api.auth.signIn, {
          request: {
            provider: "password",
            params: {
              email: TEST_EMAIL,
              password: "nobueno",
              flow: "signIn",
            },
          },
        }),
    ).rejects.toThrow(/ACCOUNT_NOT_FOUND|Invalid credentials|RATE_LIMITED/);
  }

  await expect(
    async () =>
      await t.action(api.auth.signIn, {
        request: {
          provider: "password",
          params: {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
            flow: "signIn",
          },
        },
      }),
  ).rejects.toThrow(/ACCOUNT_NOT_FOUND|Invalid credentials|RATE_LIMITED/);

  vi.advanceTimersByTime(8 * MINUTE_MS);

  const tokens = expectSignInSession(
    await t.action(api.auth.signIn, {
      request: {
        provider: "password",
        params: {
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
          flow: "signIn",
        },
      },
    }),
  );
  expect(tokens).not.toBeNull();
});

test("unknown credentials attempts consume the same opaque bucket after signup", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema);
  const email = "unknown-rate-limit@example.com";

  for (let i = 0; i < 10; i++) {
    await expect(
      t.action(api.auth.signIn, {
        request: {
          provider: "password",
          params: {
            email: email.toUpperCase(),
            password: "incorrect-password",
            flow: "signIn",
          },
        },
      }),
    ).rejects.toThrow(/ACCOUNT_NOT_FOUND|Invalid credentials|RATE_LIMITED/);
  }

  await t.action(api.auth.signIn, {
    request: { provider: "password", params: { email, password: TEST_PASSWORD, flow: "signUp" } },
  });

  await expect(
    t.action(api.auth.signIn, {
      request: { provider: "password", params: { email, password: TEST_PASSWORD, flow: "signIn" } },
    }),
  ).rejects.toThrow(/RATE_LIMITED/);
});
