import { describe, expect, test } from "vitest";
import { normalizeWorkosProfile } from "./server.ts";

const user = {
  id: "user_01",
  email: "ada@example.com",
  email_verified: true,
  first_name: "Ada",
  last_name: "Lovelace",
  profile_picture_url: "https://example.com/ada.png",
};

describe("normalizeWorkosProfile", () => {
  test("maps the token response to the profile", () => {
    expect(
      normalizeWorkosProfile({
        user,
        organization_id: "org_01",
        authentication_method: "SSO",
      }),
    ).toEqual({
      id: "user_01",
      email: "ada@example.com",
      emailVerified: true,
      firstName: "Ada",
      lastName: "Lovelace",
      picture: "https://example.com/ada.png",
      organizationId: "org_01",
      authenticationMethod: "SSO",
    });
  });

  test("leaves out the fields WorkOS sends as null", () => {
    const profile = normalizeWorkosProfile({
      user: {
        ...user,
        first_name: null,
        last_name: null,
        profile_picture_url: null,
      },
      organization_id: null,
    });
    expect(profile.firstName).toBeUndefined();
    expect(profile.lastName).toBeUndefined();
    expect(profile.picture).toBeUndefined();
    expect(profile.organizationId).toBeUndefined();
  });

  test("treats an unverified email as unverified", () => {
    const profile = normalizeWorkosProfile({
      user: { ...user, email_verified: false },
    });
    expect(profile.emailVerified).toBe(false);
  });

  test("throws when the user has no id", () => {
    expect(() => normalizeWorkosProfile({ user: { ...user, id: "" } })).toThrow(
      /missing an id/,
    );
  });

  test("throws when there is no user to map", () => {
    expect(() => normalizeWorkosProfile(undefined)).toThrow(/no user/);
  });
});
