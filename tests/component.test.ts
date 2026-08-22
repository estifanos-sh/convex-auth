import { components } from "@convex/_generated/api";
import { auth } from "@convex/auth";
import { roles } from "@convex/roles";
import schema from "@convex/schema";
import { ConvexError, type GenericId } from "convex/values";
import { convexTest as baseConvexTest } from "convex-test";
import { expect, test, vi } from "vite-plus/test";

import { vAuthEventCategory, vAuthEventKind } from "../packages/auth/src/component/model";
import { register as registerAuthComponent } from "../packages/auth/src/test";
import {
  AUTH_EVENT_KINDS,
  EVENT_CATEGORIES,
  EVENT_KIND_CATEGORY,
} from "../packages/auth/src/shared/event/kinds";
import { convexTest, privateAuthForTest, pruneExpiredForTest } from "./convex/setup";

/** Literal values carried by a `v.union(v.literal(...), ...)` validator. */
function unionLiteralValues(validator: unknown): string[] {
  const union = validator as { members: Array<{ kind: string; value: string }> };
  return union.members.map((member) => {
    if (member.kind !== "literal") {
      throw new Error(`expected literal union member, got ${member.kind}`);
    }
    return member.value;
  });
}

test("auth component registers and serves public core functions", async () => {
  const t = convexTest(schema);

  const userId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.user.create, {
      data: { email: "component-user@example.com" },
    });
  });

  const user = await t.run(async (ctx) => {
    return (await ctx.runQuery(components.auth.user.get, { id: userId })) as any;
  });

  expect(user).not.toBeNull();
  expect(user?.email).toBe("component-user@example.com");
});

test("context.get resolves user, session, membership, and group in one snapshot", async () => {
  const t = baseConvexTest(schema as never, import.meta.glob("../convex/**/*.*s") as never);
  registerAuthComponent(t as never);

  const { userId, sessionId, groupId } = await t.run(async (ctx) => {
    const userId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "context-snapshot@example.com" },
    });
    const session = await ctx.runMutation(components.auth.session.create, {
      userId,
      sessionExpirationTime: Date.now() + 60_000,
    });
    const groupId = await ctx.runMutation(components.auth.group.create, {
      name: "Context Snapshot",
      slug: "context-snapshot",
      type: "organization",
    });
    await ctx.runMutation(components.auth.group.member.create, {
      groupId,
      userId,
      roleIds: [roles.orgAdmin.id],
    });
    return { userId, sessionId: session.sessionId, groupId };
  });

  const snapshot = await t.run((ctx) =>
    ctx.runQuery(components.auth.context.get, { userId, sessionId }),
  );

  expect(snapshot.user?._id).toBe(userId);
  expect(snapshot.session?._id).toBe(sessionId);
  expect(snapshot.active?.membership.userId).toBe(userId);
  expect(snapshot.active?.groupId).toBe(groupId);
  expect(snapshot.active?.group?._id).toBe(groupId);
});

test("connection.list combines every supplied filter and supports name ordering", async () => {
  const t = convexTest(schema);

  const [groupA, groupB] = await t.run(async (ctx) => {
    const a = await ctx.runMutation(components.auth.group.create, {
      name: "Connection List A",
      slug: "connection-list-a",
      type: "organization",
    });
    const b = await ctx.runMutation(components.auth.group.create, {
      name: "Connection List B",
      slug: "connection-list-b",
      type: "organization",
    });
    return [a, b];
  });

  const targetId = await t.run(async (ctx) => {
    const target = await ctx.runMutation(components.auth.connection.create, {
      groupId: groupA,
      slug: "target",
      name: "Beta",
      protocol: "saml",
      status: "active",
    });
    await ctx.runMutation(components.auth.connection.create, {
      groupId: groupA,
      slug: "target",
      name: "Alpha disabled",
      protocol: "saml",
      status: "disabled",
    });
    await ctx.runMutation(components.auth.connection.create, {
      groupId: groupB,
      slug: "target",
      name: "Alpha other group",
      protocol: "saml",
      status: "active",
    });
    await ctx.runMutation(components.auth.connection.create, {
      groupId: groupA,
      slug: "other",
      name: "Alpha other slug",
      protocol: "saml",
      status: "active",
    });
    await ctx.runMutation(components.auth.connection.create, {
      groupId: groupA,
      slug: "charlie",
      name: "Charlie",
      protocol: "saml",
      status: "active",
    });
    return target;
  });

  const filtered = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.connection.list, {
      where: { groupId: groupA, slug: "target", status: "active" },
      paginationOpts: { numItems: 10, cursor: null },
    });
  });

  expect(filtered.page.map((connection: any) => connection._id)).toEqual([targetId]);

  const ordered = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.connection.list, {
      where: { groupId: groupA, status: "active" },
      orderBy: "name",
      order: "asc",
      paginationOpts: { numItems: 10, cursor: null },
    });
  });

  expect(ordered.page.map((connection: any) => connection.name)).toEqual([
    "Alpha other slug",
    "Beta",
    "Charlie",
  ]);
});

test("group.list combines parent, slug, root, and name ordering filters", async () => {
  const t = convexTest(schema);

  const [parentA, parentB] = await t.run(async (ctx) => {
    const a = await ctx.runMutation(components.auth.group.create, {
      name: "Parent A",
      slug: "parent-a",
      type: "organization",
    });
    const b = await ctx.runMutation(components.auth.group.create, {
      name: "Parent B",
      slug: "parent-b",
      type: "organization",
    });
    return [a, b];
  });

  const targetChild = await t.run(async (ctx) => {
    const target = await ctx.runMutation(components.auth.group.create, {
      name: "Bravo",
      slug: "shared-child",
      type: "team",
      parentGroupId: parentA,
    });
    await ctx.runMutation(components.auth.group.create, {
      name: "Alpha",
      slug: "alpha-child",
      type: "team",
      parentGroupId: parentA,
    });
    await ctx.runMutation(components.auth.group.create, {
      name: "Charlie",
      slug: "charlie-child",
      type: "team",
      parentGroupId: parentA,
    });
    await ctx.runMutation(components.auth.group.create, {
      name: "Wrong parent",
      slug: "shared-child",
      type: "team",
      parentGroupId: parentB,
    });
    return target;
  });

  const filtered = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.group.list, {
      where: { parentGroupId: parentA, slug: "shared-child" },
      paginationOpts: { numItems: 10, cursor: null },
    });
  });
  expect(filtered.page.map((group: any) => group._id)).toEqual([targetChild]);

  const impossible = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.group.list, {
      where: { parentGroupId: parentA, isRoot: true },
      paginationOpts: { numItems: 10, cursor: null },
    });
  });
  expect(impossible.page).toHaveLength(0);

  const ordered = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.group.list, {
      where: { parentGroupId: parentA },
      orderBy: "name",
      order: "asc",
      paginationOpts: { numItems: 10, cursor: null },
    });
  });
  expect(ordered.page.map((group: any) => group.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
});

test("list order indexes bind exact filtered fields before paginating", async () => {
  const t = convexTest(schema);

  const [groupId, parentGroupId] = await t.run(async (ctx) => {
    const connectionGroup = await ctx.runMutation(components.auth.group.create, {
      name: "Sparse Connection Group",
      slug: "sparse-connection-group",
      type: "organization",
    });
    const parent = await ctx.runMutation(components.auth.group.create, {
      name: "Sparse Parent",
      slug: "sparse-parent",
      type: "organization",
    });
    return [connectionGroup, parent];
  });

  const [activeConnection, matchingChild] = await t.run(async (ctx) => {
    for (let i = 0; i < 20; i += 1) {
      await ctx.runMutation(components.auth.connection.create, {
        groupId,
        slug: `inactive-${i}`,
        name: `Inactive ${i}`,
        protocol: "saml",
        status: "disabled",
      });
      await ctx.runMutation(components.auth.group.create, {
        name: `Wrong Child ${i}`,
        slug: `wrong-${i}`,
        type: "team",
        parentGroupId,
      });
    }
    const connectionId = await ctx.runMutation(components.auth.connection.create, {
      groupId,
      slug: "active-target",
      name: "Active Target",
      protocol: "saml",
      status: "active",
    });
    const childId = await ctx.runMutation(components.auth.group.create, {
      name: "Target Child",
      slug: "target-child",
      type: "team",
      parentGroupId,
    });
    return [connectionId, childId];
  });

  const connectionPage = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.connection.list, {
      where: { groupId, status: "active" },
      orderBy: "status",
      order: "asc",
      paginationOpts: { numItems: 1, cursor: null },
    });
  });
  expect(connectionPage.page.map((connection: any) => connection._id)).toEqual([activeConnection]);

  const groupPage = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.group.list, {
      where: { parentGroupId, slug: "target-child" },
      orderBy: "slug",
      order: "asc",
      paginationOpts: { numItems: 1, cursor: null },
    });
  });
  expect(groupPage.page.map((group: any) => group._id)).toEqual([matchingChild]);
});

test("refresh token exchange mismatch does not delete supplied session", async () => {
  const t = convexTest(schema);

  const userId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.user.create, {
      data: { email: "refresh-mismatch@example.com" },
    });
  });

  const [sessionA, sessionB] = await t.run(async (ctx) => {
    const first = await ctx.runMutation(components.auth.session.create, {
      userId,
      sessionExpirationTime: Date.now() + 60_000,
      refreshTokenExpirationTime: Date.now() + 60_000,
    });
    const second = await ctx.runMutation(components.auth.session.create, {
      userId,
      sessionExpirationTime: Date.now() + 60_000,
      refreshTokenExpirationTime: Date.now() + 60_000,
    });
    return [first, second];
  });

  const exchanged = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.token.refresh.exchange, {
      refreshTokenId: sessionA.refreshTokenId!,
      sessionId: sessionB.sessionId,
      now: Date.now(),
      refreshTokenExpirationTime: Date.now() + 60_000,
      reuseWindowMs: 10_000,
    });
  });

  const stillExists = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.session.get, {
      id: sessionB.sessionId,
    });
  });

  expect(exchanged).toEqual({ status: "invalid" });
  expect(stillExists?._id).toBe(sessionB.sessionId);
});

test("refresh token exchange returns the session user in the rotation transaction", async () => {
  const t = convexTest(schema);
  const userId = await t.run((ctx) =>
    ctx.runMutation(components.auth.user.create, {
      data: { email: "refresh-user@example.com" },
    }),
  );
  const issued = await t.run((ctx) =>
    ctx.runMutation(components.auth.session.create, {
      userId,
      sessionExpirationTime: Date.now() + 60_000,
      refreshTokenExpirationTime: Date.now() + 60_000,
    }),
  );
  const exchanged = await t.run((ctx) =>
    ctx.runMutation(components.auth.token.refresh.exchange, {
      refreshTokenId: issued.refreshTokenId!,
      sessionId: issued.sessionId,
      now: Date.now(),
      refreshTokenExpirationTime: Date.now() + 60_000,
      reuseWindowMs: 10_000,
    }),
  );

  expect(exchanged.status).toBe("rotated");
  if (exchanged.status !== "rotated") throw new Error("expected rotated refresh token");
  expect(exchanged.user._id).toBe(userId);
  expect(exchanged.user.email).toBe("refresh-user@example.com");
});

test("session issuance retains a bounded active-session set", async () => {
  const t = convexTest(schema);
  const userId = await t.run((ctx) =>
    ctx.runMutation(components.auth.user.create, {
      data: { email: "session-cap@example.com" },
    }),
  );
  const expirationTime = Date.now() + 60_000;

  for (let index = 0; index < 17; index += 1) {
    await t.run((ctx) =>
      ctx.runMutation(components.auth.session.create, {
        userId,
        sessionExpirationTime: expirationTime + index,
        refreshTokenExpirationTime: expirationTime + index,
      }),
    );
  }

  const sessions = await t.run((ctx) => ctx.runQuery(components.auth.session.list, { userId }));
  expect(sessions).toHaveLength(16);
});

test("account switching replaces only the authenticated account's session", async () => {
  const t = convexTest(schema);
  const { authenticatedUserId, targetUserId, authenticatedSessionId } = await t.run(async (ctx) => {
    const authenticatedUserId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "signed-in@example.com" },
    });
    const targetUserId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "switched-to@example.com" },
    });
    const authenticated = await ctx.runMutation(components.auth.session.create, {
      userId: authenticatedUserId,
      sessionExpirationTime: Date.now() + 60_000,
    });
    return { authenticatedUserId, targetUserId, authenticatedSessionId: authenticated.sessionId };
  });

  const issued = await t.run((ctx) =>
    ctx.runMutation(components.auth.session.create, {
      userId: targetUserId,
      replaceSession: {
        sessionId: authenticatedSessionId,
        authenticatedUserId,
      },
      sessionExpirationTime: Date.now() + 60_000,
    }),
  );

  const state = await t.run(async (ctx) => ({
    replaced: await ctx.runQuery(components.auth.session.get, { id: authenticatedSessionId }),
    issued: await ctx.runQuery(components.auth.session.get, { id: issued.sessionId }),
  }));
  expect(issued.replacedSessionId).toBe(authenticatedSessionId);
  expect(state.replaced).toBeNull();
  expect(state.issued?.userId).toBe(targetUserId);
});

test("session replacement cannot delete a session owned by another user", async () => {
  const t = convexTest(schema);
  const { authenticatedUserId, targetUserId, otherSessionId } = await t.run(async (ctx) => {
    const authenticatedUserId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "replacement-caller@example.com" },
    });
    const targetUserId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "replacement-target@example.com" },
    });
    const other = await ctx.runMutation(components.auth.session.create, {
      userId: targetUserId,
      sessionExpirationTime: Date.now() + 60_000,
    });
    return { authenticatedUserId, targetUserId, otherSessionId: other.sessionId };
  });

  const issued = await t.run((ctx) =>
    ctx.runMutation(components.auth.session.create, {
      userId: targetUserId,
      replaceSession: {
        sessionId: otherSessionId,
        authenticatedUserId,
      },
      sessionExpirationTime: Date.now() + 60_000,
    }),
  );

  const other = await t.run((ctx) =>
    ctx.runQuery(components.auth.session.get, { id: otherSessionId }),
  );
  expect(issued.replacedSessionId).toBeUndefined();
  expect(other?._id).toBe(otherSessionId);
});

test("password recovery consumes one reset code and stages no session before rotation", async () => {
  const t = convexTest(schema);
  const { userId, accountId } = await t.run(async (ctx) => {
    const userId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "recovery-atomic@example.com" },
    });
    const accountId = await ctx.runMutation(components.auth.account.create, {
      userId,
      provider: "password",
      providerAccountId: "recovery-atomic@example.com",
      secret: "old-secret",
    });
    await Promise.all(
      ["recovery-code-one", "recovery-code-two"].map((code) =>
        ctx.runMutation(components.auth.token.verification.create, {
          accountId,
          provider: "email",
          code,
          expirationTime: Date.now() + 60_000,
        }),
      ),
    );
    return { userId, accountId };
  });

  const recover = async (code: string) =>
    await t.run((ctx) =>
      ctx.runMutation(components.auth.token.continuation.recover, {
        accountId,
        code,
        maxAttemptsPerHour: 10,
        now: Date.now(),
        passwordProvider: "password",
        provider: "webauthn",
        resetProvider: "email",
        operation: "rotate",
        secret: "new-secret",
        expirationTime: Date.now() + 60_000,
      }),
    );

  const [first, second] = await Promise.all([
    recover("recovery-code-one"),
    recover("recovery-code-two"),
  ]);
  const accepted = [first, second].filter(
    (result): result is Extract<typeof result, { status: "accepted" }> =>
      result.status === "accepted",
  );
  expect(accepted).toHaveLength(1);

  const stored = await t.run(async (ctx) => ({
    account: await ctx.runQuery(components.auth.account.get, { id: accountId }),
    sessions: await ctx.runQuery(components.auth.session.list, { userId }),
    continuation: await ctx.runQuery(components.auth.token.continuation.get, {
      id: accepted[0]!.continuationId,
      now: Date.now(),
    }),
  }));
  expect(stored.account?.secret).toBe("old-secret");
  expect(stored.sessions).toEqual([]);
  expect(stored.continuation?.subject).toEqual({ kind: "user", userId });

  const replay = await recover("recovery-code-one");
  expect(replay.status).toBe("rejected");
});

test("auth verifier lookups ignore expired verifiers", async () => {
  const t = convexTest(schema);

  const verifierId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.token.pkce.create, {
      signature: "expired-signature",
      expirationTime: Date.now() - 1,
    });
  });

  const byId = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.token.pkce.get, {
      selector: { id: verifierId },
      now: Date.now(),
    });
  });
  const bySignature = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.token.pkce.get, {
      selector: { signature: "expired-signature" },
      now: Date.now(),
    });
  });

  expect(byId).toBeNull();
  expect(bySignature).toBeNull();
});

test("pruneExpired deletes an expired session behind an older non-expired one", async () => {
  const t = convexTest(schema);
  const now = Date.now();
  const farFuture = now + 365 * 24 * 60 * 60 * 1000;

  const userId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.user.create, {
      data: { email: "prune-session@example.com" },
    });
  });

  const live = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.session.create, {
      userId,
      sessionExpirationTime: farFuture,
      refreshTokenExpirationTime: farFuture,
    });
  });
  const stale = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.session.create, {
      userId,
      sessionExpirationTime: now - 60_000,
      refreshTokenExpirationTime: farFuture,
    });
  });

  const result = await t.run(async (ctx) => {
    return await ctx.runMutation(pruneExpiredForTest(components.auth), {
      batchSize: 1,
    });
  });

  expect(result.sessions).toBe(1);

  const staleSession = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.session.get, { id: stale.sessionId });
  });
  const liveSession = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.session.get, { id: live.sessionId });
  });

  expect(staleSession).toBeNull();
  expect(liveSession?._id).toBe(live.sessionId);
});

test("pruneExpired skips never-expire verifiers and prunes expired ones", async () => {
  const t = convexTest(schema);
  const now = Date.now();

  await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.token.pkce.create, {
      signature: "never-expire-verifier",
    });
  });
  await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.token.pkce.create, {
      signature: "expired-verifier",
      expirationTime: now - 1,
    });
  });

  const result = await t.run(async (ctx) => {
    return await ctx.runMutation(pruneExpiredForTest(components.auth), {
      batchSize: 1,
    });
  });

  expect(result.authVerifiers).toBe(1);

  const survivor = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.token.pkce.get, {
      selector: { signature: "never-expire-verifier" },
      now: Date.now(),
    });
  });
  expect(survivor).not.toBeNull();
});

test("pruneExpired deletes expired provider continuations", async () => {
  const t = convexTest(schema);
  const continuationId = await t.run(async (ctx) => {
    const userId = await ctx.runMutation(components.auth.user.create, {
      data: { email: "expired-continuation@example.com" },
    });
    const accountId = await ctx.runMutation(components.auth.account.create, {
      userId,
      provider: "password",
      providerAccountId: "expired-continuation@example.com",
      secret: "old-secret",
    });
    await ctx.runMutation(components.auth.token.verification.create, {
      accountId,
      provider: "email",
      code: "expired-recovery-code",
      expirationTime: Date.now() + 60_000,
    });
    const recovery = await ctx.runMutation(components.auth.token.continuation.recover, {
      accountId,
      code: "expired-recovery-code",
      maxAttemptsPerHour: 10,
      now: Date.now(),
      passwordProvider: "password",
      provider: "webauthn",
      resetProvider: "email",
      operation: "rotate",
      secret: "staged-secret",
      expirationTime: Date.now() - 1,
    });
    if (recovery.status !== "accepted") throw new Error("expected accepted recovery");
    return recovery.continuationId;
  });

  const result = await t.run((ctx) =>
    ctx.runMutation(pruneExpiredForTest(components.auth), { batchSize: 10 }),
  );
  expect(result.authContinuations).toBe(1);
  const continuation = await t.run((ctx) =>
    ctx.runQuery(components.auth.token.continuation.get, { id: continuationId, now: Date.now() }),
  );
  expect(continuation).toBeNull();
});

test("sign-in limiter reservations are atomic and fully-refilled buckets are pruned", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    const identifier = "prune-limit@example.com";
    const first = await t.run((ctx) =>
      ctx.runMutation(components.auth.limits.signInRecord, {
        identifier,
        maxAttemptsPerHour: 1,
      }),
    );
    const second = await t.run((ctx) =>
      ctx.runMutation(components.auth.limits.signInRecord, {
        identifier,
        maxAttemptsPerHour: 1,
      }),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);

    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    const pruned = await t.run((ctx) =>
      ctx.runMutation(pruneExpiredForTest(components.auth), { batchSize: 10 }),
    );
    expect(pruned.signInLimits).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});

test("auth.member.get returns membership, roleIds, and grants", async () => {
  const t = convexTest(schema);

  const userId = (await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.user.create, {
      data: { email: "member-get@example.com" },
    });
  })) as GenericId<"User">;

  const orgId = (await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.group.create, {
      name: "Acme Org",
      slug: "acme-org",
      type: "organization",
    });
  })) as GenericId<"Group">;

  await t.run(async (ctx) => {
    return await auth.member.create(ctx, {
      data: {
        userId,
        groupId: orgId,
        roleIds: [roles.orgAdmin.id],
      },
    });
  });

  const result = await t.run(async (ctx) => {
    return await auth.member.get(ctx, {
      userId,
      groupId: orgId,
    });
  });

  expect(result.membership).toBeTruthy();
  expect(result.membership?._id).toBeTruthy();
  expect(result.roleIds).toContain(roles.orgAdmin.id);
  expect(result.grants).toContain("projects.manage");
});

test("event.append persists target projections and dedupes by eventId", async () => {
  const t = convexTest(schema);

  const groupId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.group.create, {
      name: "Event Org",
      slug: "event-org",
      type: "organization",
    });
  });
  const userId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.user.create, {
      data: { email: "event-stream@example.com" },
    });
  });

  const event = {
    eventId: "session.signed_in:user:" + userId + ":deadbeef",
    kind: "session.signed_in" as const,
    occurredAt: Date.now(),
    actor: { type: "user" as const, id: userId },
    subject: { type: "user" as const, id: userId },
    targets: [
      { kind: "user" as const, id: userId },
      { kind: "group" as const, id: groupId },
    ],
    outcome: "success" as const,
    data: { provider: "password" },
  };

  const first = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.event.append, {
      event,
      targets: event.targets,
    });
  });
  expect(first.created).toBe(true);
  expect(first.createdTargets).toHaveLength(2);

  const projection = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.event.list, {
      where: { subject: { type: "user", id: userId } },
      paginationOpts: { numItems: 10, cursor: null },
    });
  });
  expect(projection.page).toHaveLength(2);

  const second = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.event.append, {
      event,
      targets: event.targets,
    });
  });
  expect(second.created).toBe(false);
  expect(second.createdTargets).toHaveLength(0);
});

test("event.append orders different kinds in one private auth-events stream", async () => {
  const t = convexTest(schema);
  const userId = await t.run(
    async (ctx) =>
      await ctx.runMutation(components.auth.user.create, {
        data: { email: "event-order@example.com" },
      }),
  );

  for (const [eventId, kind] of [
    ["event-order:user", "user.created"],
    ["event-order:session", "session.signed_in"],
  ] as const) {
    await t.run(
      async (ctx) =>
        await ctx.runMutation(components.auth.event.append, {
          event: {
            eventId,
            kind,
            occurredAt: Date.now(),
            actor: { type: "system" },
            subject: { type: "user", id: userId },
            targets: [{ kind: "user", id: userId }],
            outcome: "success",
          },
        }),
    );
  }

  const events = await t.run(
    async (ctx) =>
      await ctx.runQuery(privateAuthForTest(components.auth).event.orderedEvents, {
        now: Date.now(),
      }),
  );
  expect(events.map(({ kind }) => kind)).toEqual(["user.created", "session.signed_in"]);
  expect(events[0]!.commitTs <= events[1]!.commitTs).toBe(true);
});

test("pruneExpired retires and deletes expired auth-event stream buckets", async () => {
  const t = convexTest(schema);
  const now = Date.now();
  const userId = await t.run((ctx) =>
    ctx.runMutation(components.auth.user.create, {
      data: { email: "event-stream-retention@example.com" },
    }),
  );
  await t.run((ctx) =>
    ctx.runMutation(components.auth.event.append, {
      event: {
        eventId: "event-retention:user",
        kind: "user.created",
        occurredAt: now,
        actor: { type: "system" },
        subject: { type: "user", id: userId },
        targets: [{ kind: "user", id: userId }],
        outcome: "success",
      },
    }),
  );
  const before = await t.run((ctx) =>
    ctx.runQuery(privateAuthForTest(components.auth).event.orderedEvents, { now }),
  );
  expect(before).toHaveLength(1);

  const result = await t.run((ctx) =>
    ctx.runMutation(pruneExpiredForTest(components.auth), {
      batchSize: 10,
      now: now + 91 * 24 * 60 * 60 * 1000 + 1,
    }),
  );

  expect(result.authEventStreams).toBe(1);
  const after = await t.run((ctx) =>
    ctx.runQuery(privateAuthForTest(components.auth).event.orderedEvents, { now }),
  );
  expect(after).toEqual([]);
});

test("event taxonomy: component validators are derived from the shared kind table with no drift", () => {
  // The component's `vAuthEventKind` / `vAuthEventCategory` validators are
  // derived from the same shared taxonomy the server union/category-map use.
  // Assert the derivation reproduces the source set exactly (no kind dropped or
  // added when collapsing the previously-duplicated lists into one source).
  const validatorKinds = unionLiteralValues(vAuthEventKind).sort();
  const sourceKinds = [...AUTH_EVENT_KINDS].sort();
  expect(validatorKinds).toEqual(sourceKinds);
  expect(new Set(validatorKinds).size).toBe(AUTH_EVENT_KINDS.length);

  const validatorCategories = unionLiteralValues(vAuthEventCategory).sort();
  expect(validatorCategories).toEqual([...EVENT_CATEGORIES].sort());

  // Every kind resolves to a category that is a valid category literal.
  for (const kind of AUTH_EVENT_KINDS) {
    expect(EVENT_CATEGORIES).toContain(EVENT_KIND_CATEGORY[kind]);
  }
});

test("event taxonomy: append+list round-trips every kind and preserves its category", async () => {
  const t = convexTest(schema);

  const userId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.user.create, {
      data: { email: "event-taxonomy@example.com" },
    });
  });

  // Append one event per kind (validated against the derived `vAuthEventKind` /
  // `vAuthEventCategory`) and read the projection back — a drift in the derived
  // validator would reject the append or drop the row.
  for (const kind of AUTH_EVENT_KINDS) {
    const eventId = `${kind}:user:${userId}:tax`;
    const appended = await t.run(async (ctx) => {
      return await ctx.runMutation(components.auth.event.append, {
        event: {
          eventId,
          kind,
          occurredAt: Date.now(),
          actor: { type: "system" as const },
          subject: { type: "user" as const, id: userId },
          targets: [{ kind: "user" as const, id: userId }],
          outcome: "success" as const,
        },
        targets: [{ kind: "user" as const, id: userId }],
      });
    });
    expect(appended.created).toBe(true);
  }

  const projection = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.event.list, {
      where: { subject: { type: "user", id: userId } },
      paginationOpts: { numItems: AUTH_EVENT_KINDS.length + 5, cursor: null },
    });
  });

  const projectedKinds = projection.page.map((event: { kind: string }) => event.kind).sort();
  expect(projectedKinds).toEqual([...AUTH_EVENT_KINDS].sort());
  for (const event of projection.page as Array<{ kind: string; category: string }>) {
    expect(event.category).toBe(
      EVENT_KIND_CATEGORY[event.kind as keyof typeof EVENT_KIND_CATEGORY],
    );
  }
});

test("auth.member.assert throws ConvexError on invalid role ids", async () => {
  const t = convexTest(schema);

  const userId = (await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.user.create, {
      data: { email: "invalid-role@example.com" },
    });
  })) as GenericId<"User">;

  const groupId = (await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.group.create, {
      name: "Role Test Org",
      slug: "role-test-org",
      type: "organization",
    });
  })) as GenericId<"Group">;

  await expect(
    t.run(async (ctx) => {
      return await auth.member.assert(ctx, {
        userId,
        groupId,
        roleIds: ["missing-role"] as any,
        grants: ["projects.read"],
      });
    }),
  ).rejects.toThrow(ConvexError);
});

test("user.list honors a phone filter even when ordering by email", async () => {
  const t = convexTest(schema);

  await t.run(async (ctx) => {
    await ctx.runMutation(components.auth.user.create, {
      data: { email: "match@example.com", phone: "+15550001111" },
    });
    await ctx.runMutation(components.auth.user.create, {
      data: { email: "other@example.com", phone: "+15559998888" },
    });
  });

  // Regression: `orderBy: "email"` used to route through the email index and
  // silently drop the `where.phone` predicate, returning every user.
  const filtered = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.user.list, {
      where: { phone: "+15550001111" },
      orderBy: "email",
      paginationOpts: { numItems: 10, cursor: null },
    });
  });

  expect(filtered.page.map((user: any) => user.phone)).toEqual(["+15550001111"]);
});

test("connection.update applies the patch and records a connection.updated audit event", async () => {
  const t = convexTest(schema);

  const groupId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.group.create, {
      name: "Audit Org",
      slug: "audit-org",
      type: "organization",
    });
  });

  const created = await t.run(async (ctx) => {
    return await auth.connection.create(ctx as any, {
      groupId,
      slug: "audit-idp",
      name: "Audit IdP",
      status: "active",
      protocol: "saml",
    });
  });
  const connectionId = created.connectionId;

  // Regression: the emitted `connection.updated` event carries `data.changed`,
  // which the component `vAuthEventData` validator must accept. Before the fix
  // this threw an ArgumentValidationError and rolled back the whole update.
  await t.run(async (ctx) => {
    await auth.connection.update(ctx as any, {
      id: connectionId,
      patch: { name: "Audit IdP (renamed)" },
    });
  });

  const after = await t.run(async (ctx) => {
    return (await ctx.runQuery(components.auth.connection.get, {
      id: connectionId,
    })) as any;
  });
  expect(after?.name).toBe("Audit IdP (renamed)");
});
