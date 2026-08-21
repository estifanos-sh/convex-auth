import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";

const PACKAGE_NAME = "@estifanos-sh/convex-auth";
const workspaceRoot = path.resolve(import.meta.dirname, "../..");
const packagePath = path.join(workspaceRoot, "packages/auth/package.json");
const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}`;

interface PackageJson {
  name: string;
  version: string;
}

interface ParsedVersion {
  core: number[];
  prerelease?: string[];
}

interface RegistryMetadata {
  versions?: Record<string, { version?: string }>;
  "dist-tags"?: Record<string, string>;
}

type ReleaseValues = Record<"package" | "version" | "tag" | "published", string>;

function parseVersion(version: string): ParsedVersion {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!match) throw new Error(`Invalid semver: ${version}`);

  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split("."),
  };
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left.localeCompare(right);
}

function compareVersions(leftVersion: string, rightVersion: string): number {
  const left = parseVersion(leftVersion);
  const right = parseVersion(rightVersion);

  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] - right.core[index];
    }
  }

  if (!left.prerelease || !right.prerelease) {
    if (!left.prerelease && !right.prerelease) return 0;
    return left.prerelease ? -1 : 1;
  }

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === undefined ? -1 : 1;
    }
    if (leftIdentifier === rightIdentifier) continue;
    return compareIdentifiers(leftIdentifier, rightIdentifier);
  }

  return 0;
}

function readPackage(): PackageJson {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as PackageJson;
  if (packageJson.name !== PACKAGE_NAME) {
    throw new Error(`Refusing to release unexpected package ${packageJson.name}.`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(packageJson.version)) {
    throw new Error(
      `npm releases require a stable x.y.z version; received ${packageJson.version}. Use pkg.pr.new for previews.`,
    );
  }
  return packageJson;
}

async function readRegistry(): Promise<RegistryMetadata> {
  const response = await fetch(`${registryUrl}?cache=${Date.now()}`, {
    headers: { "cache-control": "no-cache" },
  });
  if (response.status === 404) return { versions: {}, "dist-tags": {} };
  if (!response.ok) {
    throw new Error(`npm registry returned ${response.status}.`);
  }
  return (await response.json()) as RegistryMetadata;
}

function writeOutputs(values: ReleaseValues): void {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
  );
}

function releaseValues(packageJson: PackageJson, published: boolean) {
  return {
    package: packageJson.name,
    version: packageJson.version,
    tag: `v${packageJson.version}`,
    published: String(published),
  } satisfies ReleaseValues;
}

async function readiness(): Promise<void> {
  const packageJson = readPackage();
  const baseVersion = process.env.BASE_VERSION;
  if (!baseVersion) throw new Error("BASE_VERSION is required for readiness.");
  if (compareVersions(baseVersion, packageJson.version) >= 0) {
    throw new Error(`Version ${packageJson.version} must be newer than ${baseVersion}.`);
  }

  const registry = await readRegistry();
  if (registry.versions?.[packageJson.version]) {
    throw new Error(`${packageJson.name}@${packageJson.version} is already published.`);
  }

  const values = releaseValues(packageJson, false);
  writeOutputs(values);
  console.log(`${values.package}@${values.version} is ready to publish to npm's latest tag.`);
}

async function metadata(): Promise<void> {
  const packageJson = readPackage();
  const tag = `v${packageJson.version}`;
  if (process.env.RELEASE_TAG !== tag) {
    throw new Error(`Tag ${process.env.RELEASE_TAG} does not match ${tag}.`);
  }

  const registry = await readRegistry();
  const values = releaseValues(packageJson, Boolean(registry.versions?.[packageJson.version]));
  writeOutputs(values);
  console.log(
    `${values.package}@${values.version} release metadata is valid (published: ${values.published}).`,
  );
}

async function verify(): Promise<void> {
  const packageJson = readPackage();
  let tags: Record<string, string> = {};

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const registry = await readRegistry();
    tags = registry["dist-tags"] ?? {};
    if (tags.latest === packageJson.version) {
      if (tags.preview === packageJson.version) {
        throw new Error(`${packageJson.version} must not be assigned to the preview tag.`);
      }
      console.log(`Verified npm latest -> ${packageJson.version}; preview remains independent.`);
      return;
    }
    if (attempt < 10) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }

  throw new Error(
    `npm latest points to ${tags.latest ?? "nothing"}, expected ${packageJson.version}.`,
  );
}

const commands = { metadata, readiness, verify } satisfies Record<string, () => Promise<void>>;
const command = process.argv[2];

try {
  if (command !== "metadata" && command !== "readiness" && command !== "verify") {
    throw new Error("Usage: node scripts/release/policy.ts <readiness|metadata|verify>");
  }
  await commands[command]();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
