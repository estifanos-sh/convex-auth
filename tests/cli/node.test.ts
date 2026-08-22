import {
  convexCmd,
  readConvexDeployment,
  deploymentTypeFromAdminKey,
  doesAlreadyMatchTemplate,
  isPreviewDeployKey,
  resolveConvexSiteUrl,
  stripDeploymentTypePrefix,
  templateToSource,
} from "@estifanos-sh/convex-auth/cli/index";
import { generateKeys } from "@estifanos-sh/convex-auth/cli/keys";
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

test("convexCmd launches the project-local Convex CLI without a package manager", () => {
  const command = convexCmd("env", "get", "APP_URL");

  expect(command.file).toBe(process.execPath);
  expect(command.args[0]).toMatch(/[/\\]convex[/\\]bin[/\\]main\.js$/);
  expect(command.args.slice(1)).toEqual(["env", "get", "APP_URL"]);
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
  expectProcessExitSilently(() => deploymentTypeFromAdminKey("invalidKeyWithoutColons"));
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

test("resolveConvexSiteUrl derives a Convex site URL from a deployment name", () => {
  const deployment = readConvexDeployment({ deployment: "disciplined-pony-306" });
  expect(resolveConvexSiteUrl(deployment)).toBe("https://disciplined-pony-306.convex.site");
});

test("resolveConvexSiteUrl converts a Convex cloud URL to its HTTP actions URL", () => {
  const deployment = readConvexDeployment({ url: "https://disciplined-pony-306.convex.cloud" });
  expect(resolveConvexSiteUrl(deployment)).toBe("https://disciplined-pony-306.convex.site");
});

test("resolveConvexSiteUrl converts the standard local backend port", () => {
  const deployment = readConvexDeployment({ url: "http://127.0.0.1:3210" });
  expect(resolveConvexSiteUrl(deployment)).toBe("http://127.0.0.1:3211");
});

test("resolveConvexSiteUrl prefers an explicit site URL", () => {
  const deployment = readConvexDeployment({
    url: "https://disciplined-pony-306.convex.cloud",
    siteUrl: "https://auth.example.com/",
  });
  expect(resolveConvexSiteUrl(deployment)).toBe("https://auth.example.com");
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
  expect(isPreviewDeployKey("invalidKey")).toBe(false);
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
