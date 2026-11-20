/**
 * Host args: the args a host app passes to every call of the method's
 * functions, which both validate and the completing call hands to the
 * app's user callbacks.
 *
 * @module
 */
import { v } from "convex/values";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.ts";
import type { ComponentApi } from "./_generated/component.ts";
import {
  app,
  authenticate,
  core,
  REDIRECT_TO,
  setup,
  testApp,
} from "./signin.fixture.ts";
import { addRoute } from "../routing.ts";
import { setupWorkos } from "../server.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  app.reset();
});

describe("host args", () => {
  const redirectTo = addRoute(REDIRECT_TO, {
    kind: "organization",
    organizationId: "org_1",
  });

  test("start validates them", async () => {
    const t = setup();
    await expect(t.mutation(testApp.start, { redirectTo })).rejects.toThrow(
      /siteId/,
    );
    const { redirect } = await t.mutation(testApp.start, {
      redirectTo,
      siteId: "site_1",
    });
    expect(new URL(redirect).searchParams.get("organization")).toBe("org_1");
  });

  test("complete validates them, and hands them to the user callbacks", async () => {
    const t = setup();
    const { code, state } = await authenticate(t);
    await expect(t.mutation(testApp.plain, { code, state })).rejects.toThrow(
      /siteId/,
    );
    expect(
      await t.mutation(testApp.plain, { code, state, siteId: "site_1" }),
    ).toMatchObject({ status: "complete" });
    expect(app.signedUp).toEqual([
      expect.objectContaining({ id: "prof_1", host: { siteId: "site_1" } }),
    ]);
  });

  test("may not reuse an arg of the method's own", () => {
    expect(() =>
      setupWorkos(core, {
        component: api as unknown as ComponentApi,
        allowedRedirectOrigins: ["https://app.example.com"],
        args: { state: v.string() },
      }),
    ).toThrow(/state/);
  });
});
