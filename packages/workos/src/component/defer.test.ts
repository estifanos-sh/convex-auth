/**
 * Deferred provisioning: an app whose `provision` defers gets a ticket
 * instead of a session, and finishes the sign-in with it once it is ready.
 *
 * @module
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { AUTHORIZATION_REQUEST_TTL_MS } from "@convex-dev/auth/lib/oauth/dbHelpers";
import { app, authenticate, setup, testApp } from "./signin.fixture.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  app.reset();
});

/** Complete a sign-in the app defers, and return its ticket. */
async function defer(t: ReturnType<typeof setup>): Promise<string> {
  app.answer = { defer: true };
  const result = await t.mutation(testApp.complete, {
    ...(await authenticate(t)),
    siteId: "site_1",
  });
  if (result.status !== "deferred") {
    throw new Error(`expected a deferred sign-in, got ${result.status}`);
  }
  return result.ticket;
}

const asked = {
  profile: expect.objectContaining({ id: "prof_1", email: "ada@acme.com" }),
  host: { siteId: "site_1" },
};
const account = expect.objectContaining({
  id: "prof_1",
  host: { siteId: "site_1" },
});
const INVALID_CODE = { status: "error", userError: { error: "INVALID_CODE" } };

describe("deferred provisioning", () => {
  test("a ready account signs up at once", async () => {
    const t = setup();
    expect(
      await t.mutation(testApp.complete, {
        ...(await authenticate(t)),
        siteId: "site_1",
      }),
    ).toMatchObject({ status: "complete", tokens: { userId: "user_1" } });
    expect(app.asked).toEqual([asked]);
    expect(app.signedUp).toEqual([account]);
  });

  test("a deferred sign-in mints no session, and finishes once provisioned", async () => {
    const t = setup();
    const ticket = await defer(t);
    expect(app.signedUp).toEqual([]);

    app.answer = { ready: true };
    expect(
      await t.mutation(testApp.finish, { ticket, siteId: "site_1" }),
    ).toMatchObject({
      status: "complete",
      tokens: { userId: "user_1" },
    });
    expect(app.asked).toEqual([asked, asked]);
    expect(app.signedUp).toEqual([account]);
  });

  test("a finish before provisioning returns the same ticket", async () => {
    const t = setup();
    const ticket = await defer(t);
    expect(
      await t.mutation(testApp.finish, { ticket, siteId: "site_1" }),
    ).toEqual({
      status: "deferred",
      ticket,
    });
    app.answer = { ready: true };
    expect(
      await t.mutation(testApp.finish, { ticket, siteId: "site_1" }),
    ).toMatchObject({
      status: "complete",
    });
  });

  test("a finish carries its own host args to provision and sign-up", async () => {
    const t = setup();
    const ticket = await defer(t);
    app.answer = { ready: true };
    await expect(t.mutation(testApp.finish, { ticket })).rejects.toThrow(
      /siteId/,
    );
    expect(
      await t.mutation(testApp.finish, { ticket, siteId: "site_2" }),
    ).toMatchObject({ status: "complete", tokens: { userId: "user_1" } });
    expect(app.asked).toEqual([
      asked,
      { ...asked, host: { siteId: "site_2" } },
    ]);
    expect(app.signedUp).toEqual([
      expect.objectContaining({ id: "prof_1", host: { siteId: "site_2" } }),
    ]);
  });

  test("a ticket is spent once", async () => {
    const t = setup();
    const ticket = await defer(t);
    app.answer = { ready: true };
    await t.mutation(testApp.finish, { ticket, siteId: "site_1" });
    expect(
      await t.mutation(testApp.finish, { ticket, siteId: "site_1" }),
    ).toEqual(INVALID_CODE);
    expect(app.signedUp).toHaveLength(1);
  });

  test("the finished account signs in again without provisioning", async () => {
    const t = setup();
    const ticket = await defer(t);
    app.answer = { ready: true };
    await t.mutation(testApp.finish, { ticket, siteId: "site_1" });
    app.asked.length = 0;
    expect(
      await t.mutation(testApp.complete, {
        ...(await authenticate(t)),
        siteId: "site_1",
      }),
    ).toMatchObject({ status: "complete", tokens: { userId: "user_1" } });
    expect(app.asked).toEqual([]);
    expect(app.signedIn).toEqual([{ userId: "user_1", profile: account }]);
  });

  test("completion cannot redeem a deferred ticket", async () => {
    const t = setup();
    const ticket = await defer(t);
    expect(
      await t.mutation(testApp.complete, {
        code: ticket,
        state: ticket,
        siteId: "site_1",
      }),
    ).toEqual(INVALID_CODE);
  });

  test("a deferred ticket lives as long as an authorization request", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = setup();
    const ticket = await defer(t);
    app.answer = { ready: true };
    vi.setSystemTime(Date.now() + AUTHORIZATION_REQUEST_TTL_MS + 1000);
    expect(
      await t.mutation(testApp.finish, { ticket, siteId: "site_1" }),
    ).toEqual(INVALID_CODE);
  });
});
