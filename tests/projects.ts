import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectNames = ["convex", "node", "interop"] as const;
const testsDirectory = path.resolve(import.meta.dirname);
const workspaceDirectory = path.resolve(testsDirectory, "..");

async function findTestFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return await findTestFiles(entryPath);
      if (!entry.isFile() || !entry.name.endsWith(".test.ts")) return [];
      return [path.relative(workspaceDirectory, entryPath).replaceAll(path.sep, "/")];
    }),
  );
  return files.flat();
}

async function listProjectFiles(project: (typeof projectNames)[number]) {
  const { stdout } = await execFileAsync(
    "vp",
    ["test", "list", "--project", project, "--filesOnly"],
    { cwd: workspaceDirectory, maxBuffer: 20 * 1024 * 1024 },
  );
  const files = stdout.matchAll(/^\[[^\]]+\]\s+(tests\/.+\.test\.ts)$/gm);
  return new Set([...files].map((match) => match[1]));
}

const testFiles = new Set(await findTestFiles(testsDirectory));
const projectFiles = await Promise.all(
  projectNames.map(async (project) => [project, await listProjectFiles(project)] as const),
);
const owners = new Map<string, string[]>();

for (const [project, files] of projectFiles) {
  for (const file of files) {
    const fileOwners = owners.get(file) ?? [];
    fileOwners.push(project);
    owners.set(file, fileOwners);
  }
}

const unassigned = [...testFiles].filter((file) => !owners.has(file));
const overlapping = [...owners].filter(([, fileOwners]) => fileOwners.length > 1);
const unknown = [...owners].filter(([file]) => !testFiles.has(file));

if (unassigned.length > 0 || overlapping.length > 0 || unknown.length > 0) {
  const details = [
    unassigned.length > 0 && `unassigned: ${unassigned.join(", ")}`,
    overlapping.length > 0 &&
      `overlapping: ${overlapping
        .map(([file, fileOwners]) => `${file} (${fileOwners.join(", ")})`)
        .join(", ")}`,
    unknown.length > 0 && `unknown: ${unknown.map(([file]) => file).join(", ")}`,
  ].filter(Boolean);
  throw new Error(`Invalid test-project assignment: ${details.join("; ")}`);
}

console.log(`Verified ${testFiles.size} test files are assigned to exactly one test project.`);
