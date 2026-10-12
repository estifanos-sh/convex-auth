/**
 * The Admin Portal, ending a user's WorkOS sessions, and managing
 * organizations and memberships, against an in-memory WorkOS.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api.ts";
import {
  copy,
  quiesce,
  replica,
  expected,
  setup,
  status,
  testAppRef,
} from "../workosTestSetup.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the Admin Portal", () => {
  it("mints a link for the intent asked, without storing it", async () => {
    const { t, fake } = setup();
    const acme = fake.organization("Acme", [{ domain: "acme.test" }]);
    for (const intent of ["sso", "dsync", "bring_your_own_key"] as const) {
      const { link } = await t.action(testAppRef.portal, {
        organization: acme,
        intent,
      });
      expect(link).toMatch(
        new RegExp(`^https://setup\\.workos\\.com/portal/${intent}/`),
      );
    }
    const sent = fake.requests.filter(
      (r) => r.path === "/portal/generate_link",
    );
    expect(sent).toHaveLength(3);
  });

  it("sends the admin's external id, and refuses a return URL off the allowed origins", async () => {
    const { t, fake } = setup();
    const acme = fake.organization("Acme", []);
    await t.action(testAppRef.portal, {
      organization: acme,
      intent: "sso",
      returnUrl: "https://app.example.com/settings",
      externalUserId: "admin-1",
    });
    const sent = fake.requests.find((r) => r.path === "/portal/generate_link");
    expect(sent?.body).toMatchObject({
      return_url: "https://app.example.com/settings",
      external_user_id: "admin-1",
    });
    await expect(
      t.action(testAppRef.portal, {
        organization: acme,
        intent: "sso",
        returnUrl: "https://evil.example/phish",
      }),
    ).rejects.toThrow(/allowedRedirectOrigins/);
  });

  it("refuses without an API key bound, naming what is missing", async () => {
    const { t } = setup();
    vi.stubEnv("CLIENT_SECRET", "");
    await expect(
      t.action(testAppRef.portal, { organization: "org", intent: "sso" }),
    ).rejects.toThrow(/CLIENT_SECRET/);
  });
});

describe("revoking WorkOS sessions", () => {
  it("revokes every active session of the user and no one else's", async () => {
    const { t, fake } = setup();
    const ada = fake.user("ada@acme.test");
    const bob = fake.user("bob@acme.test");
    fake.sessions.set("s1", { id: "s1", user_id: ada, status: "active" });
    fake.sessions.set("s2", { id: "s2", user_id: ada, status: "active" });
    fake.sessions.set("s3", { id: "s3", user_id: bob, status: "active" });

    expect(await t.action(testAppRef.revoke, { user: ada })).toBe(2);

    expect(
      [...fake.sessions.values()].map((row) => [row.user_id, row.status]),
    ).toEqual([
      [ada, "revoked"],
      [ada, "revoked"],
      [bob, "active"],
    ]);
  });

  it("throws while WorkOS can't revoke, so the caller doesn't sign out first", async () => {
    const { t, fake } = setup();
    const ada = fake.user("ada@acme.test");
    fake.sessions.set("s1", { id: "s1", user_id: ada, status: "active" });
    fake.fail(503, 1, "/user_management/sessions/revoke");

    await expect(t.action(testAppRef.revoke, { user: ada })).rejects.toThrow();
    expect(fake.sessions.get("s1")?.status).toBe("active");

    expect(await t.action(testAppRef.revoke, { user: ada })).toBe(1);
    expect(fake.sessions.get("s1")?.status).toBe("revoked");
  });
});

describe("managing organizations", () => {
  it("writes through WorkOS and lets the sync copy the result", async () => {
    const { t } = setup();
    await quiesce(t);
    const created = await t.action(testAppRef.createOrganization, {
      name: "Initech",
    });
    expect(created).toMatchObject({ name: "Initech", deleted: false });
    expect((await status(t)).pending).toBe(true);
    await quiesce(t);
    expect(
      await t.query(api.directory.organization, {
        workosId: created.workosId,
      }),
    ).toMatchObject({ name: "Initech" });
  });

  it("adds a member, and the handlers see the membership once", async () => {
    const { t, fake } = setup();
    const acme = fake.organization("Acme", []);
    const ada = fake.user("ada@acme.test");
    await quiesce(t);
    const membership = await t.action(testAppRef.createMembership, {
      user: ada,
      organization: acme,
      role: "admin",
    });
    await quiesce(t);
    expect((await copy(t)).memberships).toEqual([membership.workosId]);
    expect(await replica(t)).toEqual(expected(fake));
  });

  it("reads a membership from WorkOS itself, ahead of the copy", async () => {
    const { t, fake } = setup();
    const acme = fake.organization("Acme", []);
    const ada = fake.user("ada@acme.test");
    const membership = fake.membership(ada, acme, "admin");
    await quiesce(t);

    fake.deleteMembership(membership);
    // The copy still has it until the next sync; WorkOS doesn't.
    expect((await copy(t)).memberships).toEqual([membership]);
    expect(
      await t.action(testAppRef.fetchMembership, {
        user: ada,
        organization: acme,
      }),
    ).toBeNull();

    const bob = fake.user("bob@acme.test");
    fake.membership(bob, acme, "member");
    expect(
      await t.action(testAppRef.fetchMembership, {
        user: bob,
        organization: acme,
      }),
    ).toMatchObject({ user: bob, organization: acme, role: "member" });
  });
});
