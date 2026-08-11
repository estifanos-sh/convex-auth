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
  vi.resetModules();
  for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

async function keyringWithPrivateKey(jwtPrivateKey: string) {
  const keyring = JSON.parse((await generateKeys()).AUTH_KEYS) as { jwtPrivateKey: string };
  keyring.jwtPrivateKey = jwtPrivateKey;
  return JSON.stringify(keyring);
}

test("AUTH_KEYS signs and verifies OAuth tokens without legacy key variables", async () => {
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
      { identity: { subject: "user1" as any, sessionId: "session1" as any } },
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
        email: "user@example.com",
        emailVerified: true,
        name: "Test User",
        picture: "https://example.com/avatar.png",
      },
    },
    {} as any,
  );

  expect(token).toBeTypeOf("string");

  const claims = decodeJwt(token);
  expect(claims.sub).toBe("user1");
  expect(claims.sid).toBe("session1");
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
    { identity: { subject: "user2" as any, sessionId: "session2" as any } },
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
    { identity: { subject: "user3" as any, sessionId: "session3" as any } },
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
    { identity: { subject: "user4" as any, sessionId: "session4" as any } },
    {} as any,
  );

  const claims = decodeJwt(token);
  expect(claims.iss).toBe("https://example.convex.site/auth");
});
