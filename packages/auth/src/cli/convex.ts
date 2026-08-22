import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

type ConvexPackageJson = {
  bin?: string | Record<string, string>;
};

const cliPathByProject = new Map<string, string>();

/** Resolve the Convex CLI installed for a project without invoking its package manager. */
export function resolveConvexCliPath(projectDirectory = process.cwd()): string {
  const projectPath = path.resolve(projectDirectory);
  const cached = cliPathByProject.get(projectPath);
  if (cached !== undefined) return cached;

  const requireFromProject = createRequire(path.join(projectPath, "package.json"));
  let packagePath: string;
  try {
    packagePath = requireFromProject.resolve("convex/package.json");
  } catch (cause) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code !== "MODULE_NOT_FOUND"
    ) {
      throw new Error("Could not resolve the project-local Convex package metadata.", { cause });
    }
    throw new Error(
      'Could not find the project-local "convex" package. Install Convex in this project before running convex-auth.',
      { cause },
    );
  }

  let parsedPackageJson: unknown;
  try {
    parsedPackageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch (cause) {
    throw new Error(`Could not read Convex package metadata at ${packagePath}.`, { cause });
  }
  if (
    typeof parsedPackageJson !== "object" ||
    parsedPackageJson === null ||
    Array.isArray(parsedPackageJson)
  ) {
    throw new Error(`Convex package metadata at ${packagePath} is not a JSON object.`);
  }
  const packageJson = parsedPackageJson as ConvexPackageJson;

  const bin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.convex;
  if (typeof bin !== "string" || bin.length === 0) {
    throw new Error('The installed "convex" package does not expose a convex CLI executable.');
  }

  const cliPath = path.resolve(path.dirname(packagePath), bin);
  try {
    if (!statSync(cliPath).isFile()) throw new Error("not a file");
  } catch (cause) {
    throw new Error(
      `The installed "convex" package points to a missing or invalid CLI file: ${cliPath}`,
      {
        cause,
      },
    );
  }
  cliPathByProject.set(projectPath, cliPath);
  return cliPath;
}

/** Build a shell-free command for the project-local Convex CLI. */
export function convexCommand(...args: string[]): { file: string; args: string[] } {
  return {
    file: process.execPath,
    args: [resolveConvexCliPath(), ...args],
  };
}
