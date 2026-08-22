import { decodeJwt, exportPKCS8, generateKeyPair } from "jose";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { generateKeys } from "@estifanos-sh/convex-auth/cli/keys";

const ORIGINAL_ENV = {
  AUTH_KEYS: process.env.AUTH_KEYS,
  CONVEX_SITE_URL: process.env.CONVEX_SITE_URL,
};

beforeEach(() => {
  delete process.env.AUTH_KEYS;
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

test("generateToken never outlives its durable session", async () => {
  vi.useFakeTimers();
  const now = new Date("2026-08-22T12:00:00.000Z");
  vi.setSystemTime(now);
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
  process.env.AUTH_KEYS = (await generateKeys()).AUTH_KEYS;

  const tokens = await import("@estifanos-sh/convex-auth/server/tokens");
  const sessionExpirationTime = now.getTime() + 5_000;
  const token = await tokens.generateToken(
    {
      identity: {
        subject: "user-session-cap" as any,
        sessionId: "session-cap" as any,
        sessionEpoch: 0,
      },
      sessionExpirationTime,
    },
    { jwt: { durationMs: 60 * 60 * 1000 } } as any,
  );

  expect(decodeJwt(token).exp).toBe(Math.floor(sessionExpirationTime / 1000));
});

async function keyringWithPrivateKey(jwtPrivateKey: string) {
  const keyring = JSON.parse((await generateKeys()).AUTH_KEYS) as { jwtPrivateKey: string };
  keyring.jwtPrivateKey = jwtPrivateKey;
  return JSON.stringify(keyring);
}

test("AUTH_KEYS signs and verifies OAuth tokens", async () => {
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
  process.env.AUTH_KEYS = (await generateKeys()).AUTH_KEYS;

  const tokens = await import("@estifanos-sh/convex-auth/server/tokens");
  const token = await tokens.generateOAuthToken({
    userId: "user-keyring",
    clientId: "client-keyring",
    scopes: ["openid"],
  });

  await expect(tokens.verifyOAuthToken(token)).resolves.toMatchObject({
    userId: "user-keyring",
    clientId: "client-keyring",
    scopes: ["openid"],
  });
});

test("generateToken retries private-key import after an invalid warmup", async () => {
  process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";
  process.env.AUTH_KEYS = await keyringWithPrivateKey("not-a-valid-private-key");

  const tokens = await import("@estifanos-sh/convex-auth/server/tokens");
  await expect(
    tokens.generateToken(
      {
        identity: { subject: "user1" as any, sessionId: "session1" as any, sessionEpoch: 0 },
        sessionExpirationTime: Date.now() + 60 * 60 * 1000,
      },
      {} as any,
    ),
  ).rejects.toThrow();

  const keys = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  process.env.AUTH_KEYS = await keyringWithPrivateKey(await exportPKCS8(keys.privateKey));

  const token = await tokens.generateToken(
    {
      identity: {
        subject: "user1" as any,
        sessionId: "session1" as any,
        sessionEpoch: 0,
        email: "user@example.com",
        emailVerified: true,
        name: "Test User",
        picture: "https://example.com/avatar.png",
      },
      sessionExpirationTime: Date.now() + 60 * 60 * 1000,
    },
    {} as any,
  );

  expect(token).toBeTypeOf("string");

  const claims = decodeJwt(token);
  expect(claims.sub).toBe("user1");
  expect(claims.sid).toBe("session1");
  expect(claims.session_epoch).toBe(0);
  expect(claims.email).toBe("user@example.com");
  expect(claims.email_verified).toBe(true);
  expect(claims.name).toBe("Test User");
  expect(claims.picture).toBe("https://example.com/avatar.png");
});

test("generateToken accepts flattened PKCS#8 private keys", async () => {
  process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";

  const keys = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const pem = await exportPKCS8(keys.privateKey);
  process.env.AUTH_KEYS = await keyringWithPrivateKey(pem.trimEnd().replace(/\n/g, " "));

  const tokens = await import("@estifanos-sh/convex-auth/server/tokens");
  const token = await tokens.generateToken(
    {
      identity: { subject: "user2" as any, sessionId: "session2" as any, sessionEpoch: 0 },
      sessionExpirationTime: Date.now() + 60 * 60 * 1000,
    },
    {} as any,
  );

  const claims = decodeJwt(token);
  expect(claims.sub).toBe("user2");
  expect(claims.sid).toBe("session2");
});

test("generateToken uses the mounted auth route as issuer", async () => {
  process.env.CONVEX_SITE_URL = "https://example.convex.site";

  const keys = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  process.env.AUTH_KEYS = await keyringWithPrivateKey(await exportPKCS8(keys.privateKey));

  const tokens = await import("@estifanos-sh/convex-auth/server/tokens");
  const token = await tokens.generateToken(
    {
      identity: { subject: "user3" as any, sessionId: "session3" as any, sessionEpoch: 0 },
      sessionExpirationTime: Date.now() + 60 * 60 * 1000,
    },
    { path: "/custom-auth" } as any,
  );

  const claims = decodeJwt(token);
  expect(claims.iss).toBe("https://example.convex.site/custom-auth");
  expect(claims.aud).toBe("convex");
});

test("generateToken defaults to the /auth issuer", async () => {
  process.env.CONVEX_SITE_URL = "https://example.convex.site";

  const keys = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  process.env.AUTH_KEYS = await keyringWithPrivateKey(await exportPKCS8(keys.privateKey));

  const tokens = await import("@estifanos-sh/convex-auth/server/tokens");
  const token = await tokens.generateToken(
    {
      identity: { subject: "user4" as any, sessionId: "session4" as any, sessionEpoch: 0 },
      sessionExpirationTime: Date.now() + 60 * 60 * 1000,
    },
    {} as any,
  );

  const claims = decodeJwt(token);
  expect(claims.iss).toBe("https://example.convex.site/auth");
});
