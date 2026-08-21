import {
  readConvexDeployment,
  deploymentTypeFromAdminKey,
  doesAlreadyMatchTemplate,
  isPreviewDeployKey,
  stripDeploymentTypePrefix,
  templateToSource,
} from "@estifanos-sh/convex-auth/cli/index";
import { bundleLegacyKeys, generateKeys } from "@estifanos-sh/convex-auth/cli/keys";
import { expect, test, vi } from "vite-plus/test";

function expectProcessExitSilently(fn: () => void) {
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    expectProcessExit(fn);
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
}

function expectProcessExit(fn: () => void) {
  const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? ""}`);
  }) as never);
  try {
    expect(fn).toThrow(/process\.exit:1/);
  } finally {
    exit.mockRestore();
  }
}

test("templateToSource strips $$ markers", () => {
  const template = "const config = {$$\n  providers: [$$],$$\n};";
  const result = templateToSource(template);
  expect(result).toBe("const config = {\n  providers: [],\n};");
  expect(result).not.toContain("$$");
});

test("templateToSource returns unchanged string when no $$ markers", () => {
  const source = "const x = 1;";
  expect(templateToSource(source)).toBe(source);
});

test("doesAlreadyMatchTemplate matches exact template", () => {
  const template = 'import { defineApp } from "convex/server";\n';
  const existing = 'import { defineApp } from "convex/server";\n';
  expect(doesAlreadyMatchTemplate(existing, template)).toBe(true);
});

test("doesAlreadyMatchTemplate matches template with wildcard content", () => {
  const template =
    'import { defineAuth } from "@estifanos-sh/convex-auth/server";\n\nconst auth = defineAuth(components.auth, {$$\n  providers: [$$],$$\n});\n';
  const existing =
    'import { defineAuth } from "@estifanos-sh/convex-auth/server";\n\nconst auth = defineAuth(components.auth, {\n  providers: [password()],\n});\n';
  expect(doesAlreadyMatchTemplate(existing, template)).toBe(true);
});

test("doesAlreadyMatchTemplate returns false for non-matching content", () => {
  const template = 'import { defineApp } from "convex/server";\n\napp.use(auth);\n';
  const existing = "// completely different file\nconsole.log('hello');\n";
  expect(doesAlreadyMatchTemplate(existing, template)).toBe(false);
});

test("stripDeploymentTypePrefix strips dev: prefix", () => {
  expect(stripDeploymentTypePrefix("dev:tall-forest-1234")).toBe("tall-forest-1234");
});

test("stripDeploymentTypePrefix strips prod: prefix", () => {
  expect(stripDeploymentTypePrefix("prod:happy-animal-5678")).toBe("happy-animal-5678");
});

test("stripDeploymentTypePrefix rejects untyped deployments", () => {
  expectProcessExitSilently(() => stripDeploymentTypePrefix("tall-forest-1234"));
});

test("deploymentTypeFromAdminKey extracts prod type", () => {
  expect(deploymentTypeFromAdminKey("prod:deploymentName|secretkey")).toBe("prod");
});

test("deploymentTypeFromAdminKey extracts dev type", () => {
  expect(deploymentTypeFromAdminKey("dev:deploymentName|secretkey")).toBe("dev");
});

test("deploymentTypeFromAdminKey rejects untyped keys", () => {
  expectProcessExitSilently(() => deploymentTypeFromAdminKey("legacyKeyWithoutColons"));
});

test("readConvexDeployment allows self-hosted admin keys with explicit url", () => {
  expect(
    readConvexDeployment({
      url: "http://127.0.0.1:3210",
      adminKey: "convex-self-hosted|secretkey",
    }),
  ).toMatchObject({
    name: "http://127.0.0.1:3210",
    type: null,
  });
});

test("isPreviewDeployKey identifies preview deploy keys", () => {
  expect(isPreviewDeployKey("preview:team-slug:project-slug|secretkey")).toBe(true);
});

test("isPreviewDeployKey returns false for concrete preview deployment keys", () => {
  expect(isPreviewDeployKey("preview:deploymentName|secretkey")).toBe(false);
});

test("isPreviewDeployKey returns false for non-preview keys", () => {
  expect(isPreviewDeployKey("prod:deploymentName|secretkey")).toBe(false);
  expect(isPreviewDeployKey("dev:deploymentName|secretkey")).toBe(false);
});

test("isPreviewDeployKey returns false for keys without pipe separator", () => {
  expect(isPreviewDeployKey("preview:team:project")).toBe(false);
  expect(isPreviewDeployKey("legacyKey")).toBe(false);
});

test("generateKeys produces signing and secret-encryption keys", async () => {
  const generated = await generateKeys();
  type GeneratedKeyring = {
    version: number;
    jwtPrivateKey: string;
    jwks: { keys: JsonWebKey[] };
    secretEncryptionKey: string;
    webauthnMaskingKey: string;
  };
  const keys = JSON.parse(generated.AUTH_KEYS) as GeneratedKeyring;

  expect(keys.version).toBe(1);
  expect(keys.jwtPrivateKey).toContain("-----BEGIN PRIVATE KEY-----");
  expect(keys.jwtPrivateKey).toContain("-----END PRIVATE KEY-----");
  expect(keys.jwtPrivateKey).toContain("\n");

  expect(keys.jwks.keys).toBeInstanceOf(Array);
  expect(keys.jwks.keys.length).toBe(1);

  const jwk = keys.jwks.keys[0];
  expect(jwk.use).toBe("sig");
  expect(jwk.kty).toBe("OKP");
  expect(jwk.crv).toBe("Ed25519");
  expect(typeof jwk.x).toBe("string");

  expect(typeof keys.secretEncryptionKey).toBe("string");
  expect(keys.secretEncryptionKey.length).toBeGreaterThan(20);
  expect(typeof keys.webauthnMaskingKey).toBe("string");
  expect(keys.webauthnMaskingKey.length).toBeGreaterThan(20);
  expect(keys.webauthnMaskingKey).not.toBe(keys.secretEncryptionKey);
});

test("bundleLegacyKeys preserves existing cryptographic material", () => {
  const bundled = JSON.parse(
    bundleLegacyKeys({
      JWT_PRIVATE_KEY: "existing-private-key",
      JWKS: JSON.stringify({ keys: [{ kty: "OKP", x: "existing-public-key" }] }),
      AUTH_SECRET_ENCRYPTION_KEY: "existing-secret-encryption-key",
    }),
  );

  expect(bundled).toMatchObject({
    version: 1,
    jwtPrivateKey: "existing-private-key",
    jwks: { keys: [{ kty: "OKP", x: "existing-public-key" }] },
    secretEncryptionKey: "existing-secret-encryption-key",
  });
  expect(typeof bundled.webauthnMaskingKey).toBe("string");
  expect(bundled.webauthnMaskingKey.length).toBeGreaterThan(20);
});
