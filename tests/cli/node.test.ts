import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import {
  readConvexDeployment,
  deploymentTypeFromAdminKey,
  doesAlreadyMatchTemplate,
  isPreviewDeployKey,
  parseCliOptions,
  resolveConvexSiteUrl,
  stripTrailingLineBreak,
  stripDeploymentTypePrefix,
  templateToSource,
} from "@estifanos-sh/convex-auth/cli/index";
import { convexCommand, resolveConvexCliPath } from "@estifanos-sh/convex-auth/cli/convex";
import { generateKeys } from "@estifanos-sh/convex-auth/cli/keys";
import { afterEach, expect, test, vi } from "vite-plus/test";

const temporaryProjects: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const projectPath of temporaryProjects.splice(0)) {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

function createProject(): string {
  const projectPath = mkdtempSync(path.join(tmpdir(), "convex-auth-cli-test-"));
  temporaryProjects.push(projectPath);
  writeFileSync(path.join(projectPath, "package.json"), "{}\n");
  return projectPath;
}

function installConvexPackage(
  projectPath: string,
  packageJson: Record<string, unknown>,
  binPath = "bin/main.js",
): string {
  const packagePath = path.join(projectPath, "node_modules", "convex");
  const cliPath = path.join(packagePath, binPath);
  mkdirSync(path.dirname(cliPath), { recursive: true });
  writeFileSync(path.join(packagePath, "package.json"), JSON.stringify(packageJson));
  writeFileSync(cliPath, "#!/usr/bin/env node\n");
  return cliPath;
}

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

test("convexCommand launches the project-local Convex CLI without a package manager", () => {
  const projectPath = createProject();
  const cliPath = installConvexPackage(projectPath, {
    name: "convex",
    bin: { convex: "bin/main.js" },
  });
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(projectPath);

  const command = convexCommand("env", "set", "--", "SECRET", "value with spaces; $HOME");

  expect(command.file).toBe(process.execPath);
  expect(command.args[0]).toBe(realpathSync(cliPath));
  expect(command.args.slice(1)).toEqual(["env", "set", "--", "SECRET", "value with spaces; $HOME"]);
  cwd.mockRestore();
});

test("resolveConvexCliPath supports a string package bin", () => {
  const projectPath = createProject();
  const cliPath = installConvexPackage(
    projectPath,
    {
      name: "convex",
      bin: "bin/convex.js",
    },
    "bin/convex.js",
  );

  expect(resolveConvexCliPath(projectPath)).toBe(realpathSync(cliPath));
});

test("resolveConvexCliPath explains when Convex is not installed", () => {
  const projectPath = createProject();

  expect(() => resolveConvexCliPath(projectPath)).toThrow(
    /Could not find the project-local "convex" package/,
  );
});

test("resolveConvexCliPath rejects missing CLI metadata", () => {
  const projectPath = createProject();
  installConvexPackage(projectPath, { name: "convex" });

  expect(() => resolveConvexCliPath(projectPath)).toThrow(
    /does not expose a convex CLI executable/,
  );
});

test("resolveConvexCliPath reports malformed package metadata", () => {
  const projectPath = createProject();
  const packagePath = path.join(projectPath, "node_modules", "convex");
  mkdirSync(packagePath, { recursive: true });
  writeFileSync(path.join(packagePath, "package.json"), "not json");

  expect(() => resolveConvexCliPath(projectPath)).toThrow(
    /Could not resolve the project-local Convex package metadata/,
  );
});

test("resolveConvexCliPath rejects a missing CLI file", () => {
  const projectPath = createProject();
  const packagePath = path.join(projectPath, "node_modules", "convex");
  mkdirSync(packagePath, { recursive: true });
  writeFileSync(
    path.join(packagePath, "package.json"),
    JSON.stringify({ name: "convex", bin: { convex: "bin/missing.js" } }),
  );

  expect(() => resolveConvexCliPath(projectPath)).toThrow(
    /points to a missing or invalid CLI file/,
  );
});

test("resolveConvexCliPath rejects non-object package metadata", () => {
  const projectPath = createProject();
  const packagePath = path.join(projectPath, "node_modules", "convex");
  mkdirSync(packagePath, { recursive: true });
  writeFileSync(path.join(packagePath, "package.json"), "null");

  expect(() => resolveConvexCliPath(projectPath)).toThrow(
    /Could not resolve the project-local Convex package metadata/,
  );
});

test("parseCliOptions uses setup as the default command", () => {
  expect(
    parseCliOptions(["node", "convex-auth", "--app-url", "http://localhost:3000"]),
  ).toMatchObject({
    command: "setup",
    appUrl: "http://localhost:3000",
  });
});

test("parseCliOptions parses a command and deployment flags", () => {
  expect(
    parseCliOptions([
      "node",
      "convex-auth",
      "doctor",
      "--deployment",
      "dev:example-123",
      "--skip-git-check",
    ]),
  ).toMatchObject({
    command: "doctor",
    deployment: "dev:example-123",
    skipGitCheck: true,
  });
});

test("parseCliOptions rejects unknown commands", () => {
  expectProcessExitSilently(() => parseCliOptions(["node", "convex-auth", "unknown"]));
});

test("parseCliOptions rejects missing option values", () => {
  expectProcessExitSilently(() => parseCliOptions(["node", "convex-auth", "--app-url"]));
});

test("stripTrailingLineBreak removes only the CLI output terminator", () => {
  expect(stripTrailingLineBreak("value\n")).toBe("value");
  expect(stripTrailingLineBreak("value\r\n")).toBe("value");
  expect(stripTrailingLineBreak("value")).toBe("value");
  expect(stripTrailingLineBreak("value\n\n")).toBe("value\n");
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
