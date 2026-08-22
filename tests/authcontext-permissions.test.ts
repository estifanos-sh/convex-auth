import { expect, test } from "vite-plus/test";

import { getAuthContext, getAuthContextForUser } from "../packages/auth/src/server/context";

/**
 * Regression tests for active-group resolution in `getAuthContextForUser`.
 * Group context is useful even when an app defines no grants or roles, so the
 * resolver must never erase `groupId` / `role` merely because its permissions
 * vocabulary is empty.
 */

type StubOpts = {
  user: unknown;
  active?: { groupId: string; roleIds: string[]; grants: string[] } | null;
  session?: unknown;
};

function makeResolver(opts: StubOpts) {
  const calls = { contextGet: 0, args: [] as Array<{ userId: string; sessionId?: string }> };
  const resolver: any = {
    context: {
      get: async (_ctx: unknown, args: { userId: string; sessionId?: string }) => {
        calls.contextGet += 1;
        calls.args.push(args);
        const active = opts.active ?? null;
        return {
          user: opts.user,
          session: args.sessionId === undefined ? null : (opts.session ?? null),
          active:
            active === null
              ? null
              : {
                  ...active,
                  group: null,
                  membership: {
                    _id: "m1",
                    groupId: active.groupId,
                    userId: args.userId,
                    roleIds: active.roleIds,
                  },
                },
        };
      },
    },
  };
  return { resolver, calls };
}

test("getAuthContextForUser preserves active group and role when no grants are configured", async () => {
  const { resolver, calls } = makeResolver({
    user: { _id: "u1", lastActiveGroup: "g1", email: "a@b.c" },
    active: { groupId: "g1", roleIds: ["member"], grants: [] },
  });

  const result = await getAuthContextForUser(resolver, {} as any, "u1");

  expect(calls.contextGet).toBe(1);
  expect(calls.args).toEqual([{ userId: "u1" }]);
  expect(result.groupId).toBe("g1");
  expect(result.role).toBe("member");
  expect(result.grants).toEqual([]);
  expect(result.user).toEqual({ _id: "u1", lastActiveGroup: "g1", email: "a@b.c" });
  expect(() => result.assert("x")).toThrow();
});

test("getAuthContextForUser resolves membership when permissions are configured", async () => {
  const { resolver, calls } = makeResolver({
    user: { _id: "u1", lastActiveGroup: "g1" },
    active: { groupId: "g1", roleIds: ["admin"], grants: ["issues.read"] },
  });

  const result = await getAuthContextForUser(resolver, {} as any, "u1");

  expect(calls.contextGet).toBe(1);
  expect(result.groupId).toBe("g1");
  expect(result.role).toBe("admin");
  expect(result.grants).toEqual(["issues.read"]);
});

test("getAuthContextForUser falls back to the first membership", async () => {
  const { resolver, calls } = makeResolver({
    user: { _id: "u1" },
    active: { groupId: "g2", roleIds: ["viewer"], grants: [] },
  });

  const result = await getAuthContextForUser(resolver, {} as any, "u1");

  expect(calls.contextGet).toBe(1);
  expect(result.groupId).toBe("g2");
  expect(result.role).toBe("viewer");
});

test("OAuth scopes still cap resolved grants", async () => {
  const { resolver } = makeResolver({
    user: { _id: "u1", lastActiveGroup: "g1" },
    active: {
      groupId: "g1",
      roleIds: ["admin"],
      grants: ["issues.read", "issues.write"],
    },
  });

  const result = await getAuthContextForUser(resolver, {} as any, "u1", ["issues.read"]);

  expect(result.groupId).toBe("g1");
  expect(result.grants).toEqual(["issues.read"]);
});

test("getAuthContextForUser rejects an identity whose user was deleted", async () => {
  const { resolver } = makeResolver({ user: null });

  await expect(getAuthContextForUser(resolver, {} as any, "u1")).rejects.toMatchObject({
    data: { code: "NOT_SIGNED_IN" },
  });
});

test("getAuthContext rejects a session whose epoch was revoked", async () => {
  const { resolver, calls } = makeResolver({
    user: { _id: "u1", sessionEpoch: 1 },
    session: {
      _id: "s1",
      userId: "u1",
      expirationTime: Date.now() + 60_000,
      epoch: 0,
    },
  });
  const context = {
    auth: {
      getUserIdentity: async () => ({ subject: "u1", sid: "s1", session_epoch: 0 }),
    },
  } as any;

  await expect(getAuthContext(resolver, context)).resolves.toBeNull();
  expect(calls.args).toEqual([{ userId: "u1", sessionId: "s1" }]);
});

test("getAuthContext accepts the current session epoch", async () => {
  const { resolver, calls } = makeResolver({
    user: { _id: "u1", sessionEpoch: 2 },
    session: {
      _id: "s1",
      userId: "u1",
      expirationTime: Date.now() + 60_000,
      epoch: 2,
    },
  });
  const context = {
    auth: {
      getUserIdentity: async () => ({ subject: "u1", sid: "s1", session_epoch: 2 }),
    },
  } as any;

  await expect(getAuthContext(resolver, context)).resolves.toMatchObject({ userId: "u1" });
  expect(calls.contextGet).toBe(1);
});

test("getAuthContext rejects expired sessions", async () => {
  const { resolver } = makeResolver({
    user: { _id: "u1", sessionEpoch: 0 },
    session: {
      _id: "s1",
      userId: "u1",
      expirationTime: Date.now() - 1,
      epoch: 0,
    },
  });
  const context = {
    auth: {
      getUserIdentity: async () => ({ subject: "u1", sid: "s1", session_epoch: 0 }),
    },
  } as any;

  await expect(getAuthContext(resolver, context)).resolves.toBeNull();
});
