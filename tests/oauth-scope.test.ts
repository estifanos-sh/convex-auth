import { api } from "@convex/_generated/api";
import { auth as backendAuth } from "@convex/auth";
import { roles } from "@convex/roles";
import schema from "@convex/schema";
import { decodeJwt } from "jose";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { convexTest } from "./convex/setup";
import { subjectToUserId } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setupAdminMember(t: ReturnType<typeof convexTest>) {
  const signUp = await t.action(api.auth.signIn, {
    request: {
      provider: "password",
      params: { email: "admin@example.com", password: "44448888", flow: "signUp" },
    },
  });
  if (signUp.kind !== "signedIn") {
    throw new Error("Expected password signUp to return a session");
  }
  const claims = decodeJwt(signUp.session!.token);
  const userId = subjectToUserId(claims.sub!);
  const groupId = await t.run(async (ctx) => {
    const groupId = await backendAuth.group.create(ctx as any, {
      data: { name: "Acme", slug: "acme" },
    });
    await backendAuth.member.create(ctx as any, {
      data: { groupId, userId, roleIds: [roles.orgAdmin.id] },
    });
    return groupId;
  });
  return { sessionSubject: claims.sub!, userId, groupId };
}

test("OAuth scope caps member.assert grants; sessions keep full role grants", async () => {
  const t = convexTest(schema);
  const { sessionSubject, userId, groupId } = await setupAdminMember(t);

  await t.withIdentity({ subject: sessionSubject, sid: "session1" } as any).run(async (ctx) => {
    await backendAuth.member.assert(ctx as any, {
      userId,
      groupId,
      grants: ["comments.delete"],
    });
  });

  await expect(
    t
      .withIdentity({ subject: userId, client_id: "oc_test", scope: "comments.create" } as any)
      .run(async (ctx) => {
        await backendAuth.member.assert(ctx as any, {
          userId,
          groupId,
          grants: ["comments.delete"],
        });
      }),
  ).rejects.toThrow();

  await t
    .withIdentity({
      subject: userId,
      client_id: "oc_test",
      scope: "comments.delete comments.create",
    } as any)
    .run(async (ctx) => {
      await backendAuth.member.assert(ctx as any, {
        userId,
        groupId,
        grants: ["comments.delete"],
      });
    });
});

test("OAuth scope does not cap a grant check for a different user", async () => {
  const t = convexTest(schema);
  const { userId, groupId } = await setupAdminMember(t);

  await t
    .withIdentity({ subject: "different-oauth-subject", client_id: "oc_test", scope: "" } as any)
    .run(async (ctx) => {
      await backendAuth.member.assert(ctx as any, {
        userId,
        groupId,
        grants: ["comments.delete"],
      });
    });
});

test("OAuth scope caps the member.get read path, not just assert", async () => {
  const t = convexTest(schema);
  const { sessionSubject, userId, groupId } = await setupAdminMember(t);

  const sessionGrants = await t
    .withIdentity({ subject: sessionSubject, sid: "session1" } as any)
    .run(async (ctx) => {
      const resolved = await backendAuth.member.get(ctx as any, { userId, groupId });
      return resolved.grants;
    });
  expect(sessionGrants).toContain("comments.delete");

  const oauthGrants = await t
    .withIdentity({ subject: userId, client_id: "oc_test", scope: "comments.create" } as any)
    .run(async (ctx) => {
      const resolved = await backendAuth.member.get(ctx as any, { userId, groupId });
      return resolved.grants;
    });
  expect(oauthGrants).toContain("comments.create");
  expect(oauthGrants).not.toContain("comments.delete");
});
