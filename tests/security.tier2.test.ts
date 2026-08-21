import { BrowserLocksLive } from "@estifanos-sh/convex-auth/browser/locks";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { createInviteManager } from "../packages/auth/src/client/runtime/invite";

test("rate-limit decay math: 100 cycles stay within float epsilon of expected", () => {
  const MAX = 10;
  const HOUR_MS = 60 * 60 * 1000;
  let attemptsLeft = 0;
  let last = 0;
  for (let i = 0; i < 100; i += 1) {
    const now = last + 360_000;
    const elapsed = now - last;
    attemptsLeft = Math.min(MAX, attemptsLeft + (elapsed * MAX) / HOUR_MS);
    last = now;
  }
  expect(attemptsLeft).toBeCloseTo(MAX, 10);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("BrowserLocksLive uses navigator.locks when available", async () => {
  const request = vi.fn(async (_key: string, cb: () => Promise<string>) => await cb());
  vi.stubGlobal("navigator", { locks: { request } });
  const out = await BrowserLocksLive.withKey("k", async () => "ok");
  expect(out).toBe("ok");
  expect(request).toHaveBeenCalledTimes(1);
});

test("BrowserLocksLive falls back to localMutex when navigator.locks.request throws", async () => {
  const request = vi.fn(async () => {
    throw new Error("locks-not-available");
  });
  vi.stubGlobal("navigator", { locks: { request } });
  const out = await BrowserLocksLive.withKey("k", async () => "fallback");
  expect(out).toBe("fallback");
  expect(request).toHaveBeenCalledTimes(1);
});

test("invite manager ready() waits for storage-restore before persistInvite reads", async () => {
  const stored = new Map([
    ["invite:token", "stored-token-abc"],
    ["invite:email", "alice@example.com"],
  ]);
  const written = new Map<string, string>();

  const mgr = createInviteManager({
    param: () => null,
    storageGet: async (k) => stored.get(k) ?? null,
    storageSet: async (k, v) => {
      written.set(k, v);
      return true;
    },
    storageRemove: async (k) => {
      stored.delete(k);
      return true;
    },
    cleanUrlParams: () => {},
    tokenKey: "invite:token",
    emailKey: "invite:email",
  });

  expect(mgr.getPendingInvite()).toBeNull();
  await mgr.ready();
  expect(mgr.getPendingInvite()).toEqual({
    token: "stored-token-abc",
    email: "alice@example.com",
  });
  await mgr.persistInvite();
  expect(written.get("invite:token")).toBe("stored-token-abc");
});
