import { globSync } from "node:fs";

import { defineConfig } from "vite-plus/pack";

const jsExtensions = () => ({ js: ".js", dts: ".d.ts" });

const toEntryName = (file: string) =>
  file
    .replaceAll("\\", "/")
    .replace(/^src\//, "")
    .replace(/\.ts$/, "");

const entryMap = (patterns: string[], exclude: string[] = []) => {
  const excluded = new Set(exclude.map((file) => file.replaceAll("\\", "/")));
  const files = patterns
    .flatMap((pattern) => globSync(pattern))
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !excluded.has(file))
    .sort();
  return Object.fromEntries(files.map((file) => [toEntryName(file), file]));
};

const serverAndProviderEntries = entryMap(["src/server/**/*.ts", "src/providers/**/*.ts"]);
const clientExternals = [/^convex/, /^expo($|\/)/, /^react-native($|\/)/, /^react-native-passkey$/];

const publicDeclarationEntries = {
  "client/index": "src/client/index.ts",
  "browser/index": "src/browser/index.ts",
  "expo/index": "src/expo/index.ts",
  "react/index": "src/react/index.tsx",
  "permissions/index": "src/permissions/index.ts",
  otel: "src/otel.ts",
  test: "src/test.ts",
  "server/index": "src/server/index.ts",
  ...entryMap(["src/providers/**/*.ts"]),
  "component/convex.config": "src/component/convex.config.ts",
  "component/_generated/component": "src/component/_generated/component.ts",
};

const componentRuntimeEntries = entryMap(["src/component/**/*.ts"], ["src/component/index.ts"]);

export default defineConfig([
  {
    entry: serverAndProviderEntries,
    format: "esm",
    outDir: "dist",
    dts: false,
    clean: true,
    unbundle: true,
    platform: "node",
    external: [/^convex/],
    outExtensions: jsExtensions,
  },
  {
    entry: {
      "client/index": "src/client/index.ts",
      "browser/index": "src/browser/index.ts",
      "expo/index": "src/expo/index.ts",
      "react/index": "src/react/index.tsx",
    },
    format: "esm",
    outDir: "dist",
    dts: false,
    clean: false,
    unbundle: true,
    platform: "browser",
    external: [...clientExternals, "react", "react/jsx-runtime", "react/jsx-dev-runtime"],
    outExtensions: jsExtensions,
  },
  {
    entry: {
      "permissions/index": "src/permissions/index.ts",
      otel: "src/otel.ts",
      test: "src/test.ts",
    },
    format: "esm",
    outDir: "dist",
    dts: false,
    clean: false,
    unbundle: true,
    platform: "node",
    external: [/^convex/],
    outExtensions: jsExtensions,
  },
  {
    entry: componentRuntimeEntries,
    format: "esm",
    outDir: "dist",
    dts: false,
    clean: false,
    unbundle: true,
    platform: "node",
    external: [/^convex/],
    outExtensions: jsExtensions,
  },
  {
    entry: publicDeclarationEntries,
    format: "esm",
    outDir: "dist",
    dts: true,
    clean: false,
    unbundle: true,
    platform: "node",
    external: [/^convex/, "react", "react/jsx-runtime", "react/jsx-dev-runtime"],
    outExtensions: jsExtensions,
  },
  {
    entry: {
      bin: "src/cli/bin.ts",
    },
    format: "esm",
    outDir: "dist",
    dts: false,
    clean: false,
    platform: "node",
    external: [/^convex/],
    outExtensions: jsExtensions,
  },
]);
