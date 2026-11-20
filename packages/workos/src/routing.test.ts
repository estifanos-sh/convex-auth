import { describe, expect, test } from "vitest";
import { addRoute, takeRoute, type WorkosRoute } from "./routing.ts";

const REDIRECT_TO = "https://app.example.com/after?tab=sso";

describe("a WorkOS route on redirectTo", () => {
  test.each<WorkosRoute>([
    { kind: "organization", organizationId: "org_1" },
    {
      kind: "organization",
      organizationId: "org_1",
      loginHint: "ada@example.com",
      domainHint: "example.com",
    },
    { kind: "connection", connectionId: "conn_1", loginHint: "a+b@x.co" },
    { kind: "hint", domainHint: "example.com" },
    { kind: "default" },
  ])("reads back as the route the client set: %j", (route) => {
    const url = new URL(addRoute(REDIRECT_TO, route));
    expect(takeRoute(url)).toEqual(route);
    expect(url.toString()).toBe(REDIRECT_TO);
  });

  test("leaves a redirectTo that is no URL as it is", () => {
    expect(
      addRoute("not a url", { kind: "connection", connectionId: "conn_1" }),
    ).toBe("not a url");
  });

  test.each([
    ["both", "workos_organization_id=org_1&workos_connection_id=conn_1"],
    ["a malformed organization", "workos_organization_id=acme"],
    ["a malformed connection", "workos_connection_id=org_1"],
    ["a value too long", `workos_login_hint=${"a".repeat(257)}`],
  ])("refuses %s", (_name, query) => {
    expect(() => takeRoute(new URL(`${REDIRECT_TO}&${query}`))).toThrow();
  });
});
