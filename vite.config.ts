import path from "node:path";

import { defineConfig } from "vite-plus";

const convexApp = path.resolve(import.meta.dirname, "./convex");
const authSrc = path.resolve(import.meta.dirname, "./packages/auth/src");

const testProjectAliases = {
  "@convex": convexApp,
  "@convex/": `${convexApp}/`,
  "@estifanos-sh/convex-auth/test": path.join(authSrc, "test.ts"),
  "@estifanos-sh/convex-auth": authSrc,
  "@estifanos-sh/convex-auth/": `${authSrc}/`,
} as const;

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [
      ".agent/**",
      ".agents/**",
      ".claude/**",
      ".codex/**",
      ".continue/**",
      ".cursor/**",
      ".gemini/**",
      ".opencode/**",
      ".pi/**",
      ".roo/**",
      ".windsurf/**",
      "tools/oxlint/anti-slop/**",
    ],
  },
  lint: {
    ignorePatterns: [
      "**/dist/**",
      "**/_generated/**",
      "**/node_modules/**",
      ".agent/**",
      ".agents/**",
      ".claude/**",
      ".codex/**",
      ".continue/**",
      ".cursor/**",
      ".gemini/**",
      ".opencode/**",
      ".pi/**",
      ".roo/**",
      ".windsurf/**",
      ".github/**",
      "tools/oxlint/anti-slop/**",
    ],
    jsPlugins: [
      {
        name: "anti-slop",
        specifier: "./tools/oxlint/anti-slop/index.ts",
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-module-mocking": "error",
      "anti-slop/no-reflect-apply": "error",
      "anti-slop/no-reflect-get": "error",
      "anti-slop/no-widen-then-assert": "error",
    },
    overrides: [
      {
        files: ["packages/auth/src/server/validators.ts"],
        rules: {
          "anti-slop/no-chained-type-assertions": "off",
        },
      },
    ],
  },
  run: {
    cache: {
      scripts: true,
      tasks: true,
    },
    tasks: {
      "cache:build:convex-codegen": {
        command:
          "vp exec varlock run -- vp exec convex codegen --component-dir ./packages/auth/src/component && vp fmt packages/auth/src/component/_generated",
        cache: true,
        input: [
          "convex/**",
          "packages/auth/src/component/**",
          "packages/auth/src/server/**",
          "packages/auth/src/providers/**",
          "packages/auth/src/component/index.ts",
          "packages/auth/convex.config.ts",
          "package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          "tsconfig*.json",
          "vite.config.ts",
          "!**/dist/**",
          "!**/_generated/**",
        ],
      },
      "cache:build:auth": {
        command: "vp run --filter @estifanos-sh/convex-auth build",
        cache: true,
        input: [
          "convex/**",
          "packages/auth/**",
          "scripts/**",
          "package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          "tsconfig*.json",
          "vite.config.ts",
          "!packages/auth/dist/**",
          "!packages/auth/src/component/_generated/**",
        ],
      },
      "cache:build": {
        command: "vp run cache:build:convex-codegen && vp run cache:build:auth",
        cache: true,
        input: [
          "convex/**",
          "packages/**",
          "scripts/**",
          "package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          "tsconfig*.json",
          "vite.config.ts",
          "!**/dist/**",
          "!**/_generated/**",
        ],
      },
      "cache:check": {
        command: "vp lint && vp fmt --check .",
        cache: true,
        input: [
          "convex/**",
          "packages/**",
          "tests/**",
          "scripts/**",
          "skills/**",
          "docs/**",
          "package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          "tsconfig*.json",
          "vite.config.ts",
          "!**/dist/**",
          "!**/_generated/**",
        ],
      },
      "cache:test:unit": {
        command:
          "vp exec node ./tests/projects.ts && vp test --run --project convex --project node",
        cache: true,
        input: [
          "convex/**",
          "packages/**",
          "tests/**",
          "package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          "tsconfig*.json",
          "vite.config.ts",
          "!**/dist/**",
          "!**/_generated/**",
        ],
      },
      "cache:test:interop": {
        command: "vp exec node ./tests/projects.ts && vp test --run --project interop",
        cache: true,
        input: [
          "convex/**",
          "packages/**",
          "tests/**",
          "package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          "tsconfig*.json",
          "vite.config.ts",
          "!**/dist/**",
          "!**/_generated/**",
        ],
      },
      "cache:test": {
        command: "vp run cache:test:unit && vp run cache:test:interop",
        cache: true,
        input: [
          "convex/**",
          "packages/**",
          "tests/**",
          "package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          "tsconfig*.json",
          "vite.config.ts",
          "!**/dist/**",
          "!**/_generated/**",
        ],
      },
      "cache:validate": {
        command:
          "vp run typecheck:tests && vp run '@estifanos-sh/convex-auth#typecheck:consumer' && vp run '@estifanos-sh/convex-auth#check:packaging'",
        cache: true,
        input: [
          "convex/**",
          "packages/**",
          "tests/**",
          "package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          "tsconfig*.json",
          "vite.config.ts",
          "!**/dist/**",
          "!**/_generated/**",
        ],
      },
    },
  },
  test: {
    projects: [
      {
        root: "./tests",
        resolve: {
          alias: testProjectAliases,
        },
        test: {
          name: "convex",
          include: ["**/*.test.ts"],
          exclude: ["**/node.test.ts", "**/*.node.test.ts"],
          environment: "edge-runtime",
          setupFiles: ["./vitest/setup.ts"],
          server: { deps: { inline: ["convex-test"] } },
          fileParallelism: false,
          testTimeout: 10000,
        },
      },
      {
        root: "./tests",
        resolve: {
          alias: testProjectAliases,
        },
        test: {
          name: "node",
          include: ["**/node.test.ts", "**/*.node.test.ts"],
          exclude: ["connection/**/node.test.ts", "benchmarks/**/node.test.ts"],
          environment: "node",
          setupFiles: ["./vitest/setup.ts"],
          server: { deps: { inline: ["convex-test"] } },
          fileParallelism: false,
          testTimeout: 60000,
        },
      },
      {
        root: "./tests",
        resolve: {
          alias: testProjectAliases,
        },
        test: {
          name: "interop",
          include: ["connection/**/node.test.ts", "benchmarks/**/node.test.ts"],
          environment: "node",
          globalSetup: ["./infra/docker/setup/node.ts"],
          setupFiles: ["./vitest/setup.ts"],
          server: { deps: { inline: ["convex-test"] } },
          fileParallelism: false,
          testTimeout: 120000,
          sequence: {
            groupOrder: 1,
          },
        },
      },
    ],
  },
});
