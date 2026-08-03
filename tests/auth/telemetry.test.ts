import { afterEach, expect, test, vi } from "vite-plus/test";

import { configDefaults } from "../../packages/auth/src/server/config";
import {
  buildKnownSignInIdentityAttributes,
  buildRefreshIdentityAttributes,
  buildSignInIdentityAttributes,
  buildSignOutIdentityAttributes,
} from "../../packages/auth/src/server/telemetry";

const ORIGINAL_CONVEX_SITE_URL = process.env.CONVEX_SITE_URL;

function withConvexSiteUrl(url: string) {
  process.env.CONVEX_SITE_URL = url;
}

test("configDefaults throws when hashed telemetry identity is missing a hasher", () => {
  expect(() =>
    configDefaults({
      providers: [],
      component: {} as any,
      telemetry: {
        includeIdentity: "hashed",
        identityFields: { userId: true },
      },
    }),
  ).toThrow(/requires a `hashIdentity` function/);
});

test("refresh telemetry returns raw identity attributes when explicitly enabled", async () => {
  withConvexSiteUrl("https://team-a.convex.site");
  const refs = {
    userGetById: Symbol("userGetById"),
  } as const;

  const ctx = {
    runQuery: vi.fn(async (ref: unknown, args: unknown) => {
      expect(ref).toBe(refs.userGetById);
      expect(args).toEqual({ id: "user-1" });
      return { _id: "user-1", email: "user@example.com" };
    }),
  } as any;

  const config = configDefaults({
    providers: [],
    component: {
      user: {
        get: refs.userGetById,
      },
    } as any,
    telemetry: {
      includeIdentity: "raw",
      identityFields: {
        userId: true,
        sessionId: true,
        refreshTokenId: true,
        email: true,
        tokenIdentifier: true,
      },
    },
  });

  await expect(
    buildRefreshIdentityAttributes(ctx, config, {
      userId: "user-1",
      sessionId: "session-1",
      refreshTokenId: "refresh-1",
    }),
  ).resolves.toEqual({
    "auth.identity.mode": "raw",
    "auth.refresh_token.id": "refresh-1",
    "auth.session.id": "session-1",
    "auth.token_identifier": "user-1https://team-a.convex.site",
    "auth.user.email": "user@example.com",
    "auth.user.id": "user-1",
  });
});

test("refresh telemetry hashes configured identity fields", async () => {
  withConvexSiteUrl("https://team-b.convex.site");
  const hashIdentity = vi.fn((value: string, field: string) => `${field}:${value}`);

  const config = configDefaults({
    providers: [],
    component: {
      public: {
        userGetById: Symbol("unusedUserGetById"),
      },
    } as any,
    telemetry: {
      includeIdentity: "hashed",
      identityFields: {
        userId: true,
        tokenIdentifier: true,
      },
      hashIdentity,
    },
  });

  await expect(
    buildRefreshIdentityAttributes({ runQuery: vi.fn() } as any, config, {
      userId: "user-2",
      sessionId: "session-2",
      refreshTokenId: "refresh-2",
    }),
  ).resolves.toEqual({
    "auth.identity.mode": "hashed",
    "auth.token_identifier": "tokenIdentifier:user-2https://team-b.convex.site",
    "auth.user.id": "userId:user-2",
  });

  expect(hashIdentity).toHaveBeenCalledWith("user-2", "userId");
  expect(hashIdentity).toHaveBeenCalledWith("user-2https://team-b.convex.site", "tokenIdentifier");
});

test("sign-in telemetry omits refresh token attributes and preserves shared identity fields", async () => {
  withConvexSiteUrl("https://team-c.convex.site");
  const config = configDefaults({
    providers: [],
    component: {
      public: {
        userGetById: Symbol("unusedUserGetById"),
      },
    } as any,
    telemetry: {
      includeIdentity: "raw",
      identityFields: {
        userId: true,
        sessionId: true,
        refreshTokenId: true,
        tokenIdentifier: true,
      },
    },
  });

  await expect(
    buildSignInIdentityAttributes({ runQuery: vi.fn() } as any, config, {
      userId: "user-3",
      sessionId: "session-3",
    }),
  ).resolves.toEqual({
    "auth.identity.mode": "raw",
    "auth.session.id": "session-3",
    "auth.token_identifier": "user-3https://team-c.convex.site",
    "auth.user.id": "user-3",
  });
});

test("sign-in telemetry reuses the user loaded by session creation", () => {
  const config = configDefaults({
    providers: [],
    component: {} as any,
    telemetry: {
      includeIdentity: "raw",
      identityFields: { email: true, userId: true },
    },
  });

  expect(
    buildKnownSignInIdentityAttributes(
      config,
      { userId: "user-known", sessionId: "session-known" },
      "known@example.com",
    ),
  ).toEqual({
    "auth.identity.mode": "raw",
    "auth.user.email": "known@example.com",
    "auth.user.id": "user-known",
  });
});

test("sign-out telemetry supports hashed identity enrichment", async () => {
  withConvexSiteUrl("https://team-d.convex.site");
  const hashIdentity = vi.fn((value: string, field: string) => `${field}:${value}`);
  const config = configDefaults({
    providers: [],
    component: {
      public: {
        userGetById: Symbol("unusedUserGetById"),
      },
    } as any,
    telemetry: {
      includeIdentity: "hashed",
      identityFields: {
        sessionId: true,
      },
      hashIdentity,
    },
  });

  await expect(
    buildSignOutIdentityAttributes({ runQuery: vi.fn() } as any, config, {
      userId: "user-4",
      sessionId: "session-4",
    }),
  ).resolves.toEqual({
    "auth.identity.mode": "hashed",
    "auth.session.id": "sessionId:session-4",
  });

  expect(hashIdentity).toHaveBeenCalledWith("session-4", "sessionId");
});

test("telemetry tokenIdentifier falls back to user id when issuer is unavailable", async () => {
  delete process.env.CONVEX_SITE_URL;
  const config = configDefaults({
    providers: [],
    component: {
      public: {
        userGetById: Symbol("unusedUserGetById"),
      },
    } as any,
    telemetry: {
      includeIdentity: "raw",
      identityFields: {
        tokenIdentifier: true,
      },
    },
  });

  await expect(
    buildSignInIdentityAttributes({ runQuery: vi.fn() } as any, config, {
      userId: "user-5",
      sessionId: "session-5",
    }),
  ).resolves.toEqual({
    "auth.identity.mode": "raw",
    "auth.token_identifier": "user-5",
  });
});

afterEach(() => {
  if (ORIGINAL_CONVEX_SITE_URL === undefined) {
    delete process.env.CONVEX_SITE_URL;
  } else {
    process.env.CONVEX_SITE_URL = ORIGINAL_CONVEX_SITE_URL;
  }
});
