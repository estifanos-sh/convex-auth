import { v } from "convex/values";
import { describe, expect, test } from "vitest";
import { decode, DecodeError } from "./decode.ts";
import {
  EVENTS,
  vDirectoryUser,
  vOrganizationPayload,
  vProfile,
  vWorkosEvent,
} from "./validators.ts";
import { event, PAYLOADS, PROFILE, USER } from "./workos.fixture.ts";

describe("decode", () => {
  test("names a payload for every event the copy applies", () => {
    expect(Object.keys(PAYLOADS).sort()).toEqual([...EVENTS].sort());
  });

  test.each(EVENTS)("decodes %s", (name) => {
    const wire = event(name);
    const decoded = decode(vWorkosEvent, wire);
    expect(decoded.event).toBe(name);
    expect(decoded.id).toBe(wire.id);
    expect(Object.keys(decoded).sort()).toEqual(["data", "event", "id"]);
  });

  test("keeps the fields it names, and drops the rest and WorkOS's nulls", () => {
    expect(decode(vDirectoryUser, USER)).toEqual({
      object: "directory_user",
      id: "directory_user_1",
      directory_id: "directory_1",
      organization_id: "org_1",
      idp_id: "00u1",
      email: "Ada@Acme.com",
      first_name: "Ada",
      state: "active",
      role: { slug: "member" },
      roles: [{ slug: "member" }],
    });
  });

  test("decodes the SSO profile the method signs in with", () => {
    expect(decode(vProfile, PROFILE)).toEqual({
      object: "profile",
      id: "prof_1",
      idp_id: "00u1",
      organization_id: "org_1",
      connection_id: "conn_1",
      connection_type: "OktaSAML",
      email: "ada@acme.com",
      first_name: "Ada",
    });
  });

  test("refuses a missing profile", () => {
    expect(() => decode(vProfile, undefined)).toThrow(DecodeError);
  });

  test("an organization lists its domains, without their owner", () => {
    const decoded = decode(
      vOrganizationPayload,
      PAYLOADS["organization.created"],
    );
    expect(decoded.domains).toEqual([
      {
        object: "organization_domain",
        id: "org_domain_1",
        domain: "Acme.com",
        state: "verified",
      },
    ]);
  });

  test("names where a payload is wrong, and never its values", () => {
    const wire = event("dsync.user.updated", {
      ...USER,
      email: "grace@acme.com",
      state: "archived",
    });
    expect(() => decode(vWorkosEvent, wire)).toThrow(
      new DecodeError(".data.state", "one of its kinds"),
    );
    try {
      decode(vWorkosEvent, wire);
    } catch (error) {
      expect(String(error)).not.toContain("grace");
      expect(String(error)).not.toContain("archived");
    }
  });

  test("refuses an event it does not apply, by its name", () => {
    expect(() => decode(vWorkosEvent, event("user.created", {}))).toThrow(
      /it says event "user.created"/,
    );
  });

  test("refuses a required field that is null", () => {
    expect(() => decode(v.object({ id: v.string() }), { id: null })).toThrow(
      new DecodeError(".id", "text"),
    );
  });
});
