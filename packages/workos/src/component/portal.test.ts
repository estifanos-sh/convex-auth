import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.ts";
import { json, setup, stubFetch } from "./workos.fixture.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("an Admin Portal link is generated for one organization and intent", async () => {
  const t = setup();
  const calls = stubFetch(() => json({ link: "https://setup.workos.com/x" }));
  expect(
    await t.action(api.portal.link, {
      organizationId: "org_1",
      intent: "sso",
      returnUrl: "https://app.example.com/settings",
    }),
  ).toBe("https://setup.workos.com/x");
  const [call] = calls;
  expect(call?.url.pathname).toBe("/portal/generate_link");
  expect(call?.init.method).toBe("POST");
  expect(JSON.parse(String(call?.init.body))).toEqual({
    organization: "org_1",
    intent: "sso",
    return_url: "https://app.example.com/settings",
  });
});
