import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const content = path.join(root, "docs", "src", "content");

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

const contentFiles = walk(content).filter((file) => file.endsWith("+page.md"));
const routeContent = walk(path.join(root, "docs", "src", "routes")).filter((file) =>
  file.endsWith("+page.md"),
);
if (routeContent.length > 0) {
  throw new Error(
    `Documentation pages must live in docs/src/content, not routes: ${routeContent
      .map((file) => path.relative(root, file))
      .join(", ")}.`,
  );
}
const files = [
  ...contentFiles,
  path.join(root, "README.md"),
  path.join(root, "packages", "auth", "README.md"),
  path.join(root, "packages", "auth", "MIGRATION-vNext.md"),
];
const source = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));

const forbidden = [
  { pattern: /\bauthEnv\b/u, reason: "application configuration owns provider values" },
  { pattern: /\bas\s+unknown\s+as\b/u, reason: "documentation must not normalize casts" },
  {
    pattern: /ctx\.auth\.user\.viewer\(ctx\)/u,
    reason: "auth.ctx() already provides ctx.auth.user",
  },
  { pattern: /session\.(?:issue|archive)\b/u, reason: "the public session verbs are current" },
  { pattern: /replaceSessionId\b/u, reason: "session replacement is lifecycle-owned" },
  {
    pattern: /\b(?:env|process\.env)\.[A-Z0-9_]+!/u,
    reason: "examples must validate required environment values instead of asserting them",
  },
] as const;

for (const [file, markdown] of source) {
  for (const { pattern, reason } of forbidden) {
    if (pattern.test(markdown)) {
      throw new Error(`${path.relative(root, file)} violates docs truth: ${reason}.`);
    }
  }
}

const removedEnvironmentSurface = [
  path.join(root, "packages", "auth", "src", "server", "env.ts"),
  path.join(root, "packages", "auth", "src", "server", "index.ts"),
  path.join(root, "packages", "auth", "src", "cli", "index.ts"),
  path.join(root, "convex", "convex.config.ts"),
  path.join(root, "skills", "estifanos-sh-convex-auth-setup", "SKILL.md"),
  path.join(root, "skills", "estifanos-sh-convex-auth-setup", "references", "server.md"),
];
for (const file of removedEnvironmentSurface) {
  if (/\b(?:authEnv|AuthEnv)\b/u.test(readFileSync(file, "utf8"))) {
    throw new Error(`${path.relative(root, file)} still depends on the removed auth environment.`);
  }
}

const required = [
  {
    file: path.join(content, "getting-started", "installation", "+page.md"),
    fragments: [
      "client({ convex, api: api.auth })",
      "no `InferClientApi`, generic argument, or assertion",
    ],
  },
  {
    file: path.join(content, "getting-started", "providers", "+page.md"),
    fragments: ["afterReset: passkeys.rotate()", "No restricted or normal session exists"],
  },
  {
    file: path.join(content, "integration", "context", "+page.md"),
    fragments: ["one component query", "that snapshot"],
  },
  {
    file: path.join(content, "api", "session", "+page.md"),
    fragments: ["session epoch", "at most 16 non-expired sessions"],
  },
  {
    file: path.join(content, "api", "user", "+page.md"),
    fragments: ["auth.group.active.update", "auth.group.active.reset"],
  },
  {
    file: path.join(content, "reference", "config", "+page.md"),
    fragments: ["`path`", "not as a top-level config option"],
  },
  {
    file: path.join(content, "reference", "cli", "+page.md"),
    fragments: ["`doctor`", "`urls`", "`keys`", "8 steps"],
  },
  {
    file: path.join(content, "getting-started", "environment", "+page.md"),
    fragments: ["belong to the application", "does not reserve a second set of"],
  },
  {
    file: path.join(content, "getting-started", "providers", "+page.md"),
    fragments: ["`credentials()` is the low-level escape hatch", "application schema"],
  },
  {
    file: path.join(content, "reference", "architecture", "+page.md"),
    fragments: ["Do not issue an ordinary session", "Tables for password or PIN hashes"],
  },
] as const;

for (const { file, fragments } of required) {
  const markdown = source.get(file);
  if (markdown === undefined) throw new Error(`Missing documentation source: ${file}`);
  const normalized = markdown.replace(/\s+/gu, " ");
  for (const fragment of fragments) {
    if (!normalized.includes(fragment.replace(/\s+/gu, " "))) {
      throw new Error(`${path.relative(root, file)} is missing required guidance: ${fragment}`);
    }
  }
}

console.log(`Verified ${contentFiles.length} documentation pages against current auth contracts.`);
