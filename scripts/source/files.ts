import { readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const ignoredDirectories = new Set([
  ".expo",
  ".git",
  ".svelte-kit",
  "_generated",
  "build",
  "dist",
  "node_modules",
]);
const loaderConfigurationFiles = new Set([
  "demos/expo/eslint.config.js",
  "demos/expo/metro.config.js",
  "demos/svelte/svelte.config.js",
  "packages/auth/svelte.config.js",
]);

function collectRawJavaScript(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];

    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectRawJavaScript(file);
    if (!entry.name.endsWith(".js") && !entry.name.endsWith(".mjs")) return [];
    return [path.relative(root, file).split(path.sep).join("/")];
  });
}

const rawJavaScript = collectRawJavaScript(root).sort();
const unexpected = rawJavaScript.filter((file) => !loaderConfigurationFiles.has(file));

if (unexpected.length > 0) {
  throw new Error(
    `Authored JavaScript must use TypeScript. Rename these files:\n${unexpected
      .map((file) => `- ${file}`)
      .join("\n")}`,
  );
}

const missingConfigurations = [...loaderConfigurationFiles].filter(
  (file) => !rawJavaScript.includes(file),
);
if (missingConfigurations.length > 0) {
  throw new Error(
    `Remove obsolete JavaScript loader exceptions:\n${missingConfigurations
      .map((file) => `- ${file}`)
      .join("\n")}`,
  );
}

console.log(
  `Verified TypeScript-only authored source (${loaderConfigurationFiles.size} framework loader exceptions).`,
);
