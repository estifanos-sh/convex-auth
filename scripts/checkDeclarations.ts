#!/usr/bin/env tsx
// Checks the declarations that `@convex-dev/auth` and
// `@estifanos-sh/convex-workos` publish. Run it after `pnpm build`, because it
// reads their `dist/`.
//
// `stripInternal` removes the declarations tagged `@internal` from `dist/`,
// but it keeps the references to them. A public signature that uses an
// `@internal` type thus refers to a name that does not exist, and `tsc` does
// not report it. A consumer with `skipLibCheck` gets `any` and no error. This
// script typechecks the emitted declarations, and it finds these references.
//
// It also checks the `exports` map:
//
//   - No key and no target has a `*`. A wildcard publishes every file in a
//     directory, including the internal ones, thus each entry is explicit.
//   - Each target file exists.
//   - Each entry of `@convex-dev/auth` with a `types` target has the
//     `convex-auth-internal-types` condition first, pointing to the same file
//     in `dist/internal-types/`. The WorkOS package builds on those internal
//     declarations, and its own declarations must still typecheck for a
//     consumer that does not set the condition.
//
// Usage: pnpm check:declarations

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const internalCondition = "convex-auth-internal-types";

const errors: string[] = [];

type ExportTarget = string | null | { [condition: string]: ExportTarget };

function targetPaths(target: ExportTarget): string[] {
  if (target === null) return [];
  if (typeof target === "string") return [target];
  return Object.values(target).flatMap(targetPaths);
}

const packages = [
  { dir: join(root, "packages", "core"), internalTypes: true },
  { dir: join(root, "packages", "workos"), internalTypes: false },
];

for (const { dir, internalTypes } of packages) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
    name: string;
    exports: Record<string, ExportTarget>;
  };
  for (const [key, target] of Object.entries(pkg.exports)) {
    const where = `${pkg.name}: exports["${key}"]`;
    if (key.includes("*")) {
      errors.push(`${where}: the key must not have a "*".`);
    }
    for (const path of targetPaths(target)) {
      if (path.includes("*")) {
        errors.push(`${where}: the target "${path}" must not have a "*".`);
      } else if (!existsSync(join(dir, path))) {
        errors.push(`${where}: the target "${path}" does not exist.`);
      }
    }
    if (!internalTypes) continue;
    if (target === null || typeof target !== "object") continue;
    if (typeof target.types !== "string") continue;
    const expected = target.types.replace(
      /^\.\/dist\//,
      "./dist/internal-types/",
    );
    const internal = target[internalCondition];
    const internalTarget =
      internal !== null && typeof internal === "object" ? internal.types : null;
    if (Object.keys(target)[0] !== internalCondition) {
      // Conditions match in key order, thus `types` would win if it came first.
      errors.push(
        `${where}: "${internalCondition}" must be the first condition.`,
      );
    } else if (internalTarget !== expected) {
      errors.push(
        `${where}: "${internalCondition}" must be { "types": "${expected}" }.`,
      );
    }
  }
}

function declarationFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".d.ts"))
    .map((entry) => join(entry.parentPath, entry.name));
}

// The options of a typical consumer. No `types`: the declarations must not
// need `@types/node` or `vite/client`.
const distDirs = packages.map(({ dir }) => join(dir, "dist"));
const program = ts.createProgram(distDirs.flatMap(declarationFiles), {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ESNext,
  lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  types: [],
  skipLibCheck: false,
});

// The declarations of some dependencies (for example `next`) do not
// typecheck on their own. Only the files in `dist/` are reported.
const diagnostics = program
  .getSourceFiles()
  .filter((file) =>
    distDirs.some((dir) => resolve(file.fileName).startsWith(dir + sep)),
  )
  .flatMap((file) => [
    ...program.getSyntacticDiagnostics(file),
    ...program.getSemanticDiagnostics(file),
  ]);
if (diagnostics.length > 0) {
  errors.push(
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }),
  );
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  "The declarations of @convex-dev/auth and @estifanos-sh/convex-workos are correct.",
);
