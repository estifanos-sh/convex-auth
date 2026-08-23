import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs as parseNodeArgs } from "node:util";

import * as p from "@clack/prompts";
import { config as loadEnvFile } from "dotenv";
import figlet from "figlet";
import ansiShadow from "figlet/importable-fonts/ANSI Shadow.js";
import gradientString from "gradient-string";

import { convexCommand } from "./convex";
import { generateKeys } from "./keys";

figlet.parseFont("ANSI Shadow", ansiShadow);

const convexGradient = gradientString(["purple", "pink", "orange"]);

function printBanner() {
  const banner = figlet.textSync("CONVEX-AUTH", {
    font: "ANSI Shadow",
    horizontalLayout: "default",
  });
  console.log("\n" + convexGradient(banner));
  console.log("  \x1b[35m✦ auth, wired into your convex backend  ✦\x1b[0m\n");
}

function getPackageVersion(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  for (const relative of ["..", "../.."]) {
    try {
      const pkgPath = path.resolve(currentDir, relative, "package.json");
      return JSON.parse(readFileSync(pkgPath, "utf-8")).version;
    } catch {
      /* empty */
    }
  }
  return "unknown";
}

const version = getPackageVersion();

type DeploymentOptions = {
  url?: string;
  siteUrl?: string;
  adminKey?: string;
  prod?: boolean;
  deployment?: string;
};

type ConvexDeployment = {
  name: string | null;
  type: "dev" | "prod" | "preview" | null;
  options: DeploymentOptions;
};

type CliOptions = DeploymentOptions & {
  command: "setup" | "doctor" | "urls" | "keys";
  appUrl?: string;
  variables?: string;
  skipGitCheck: boolean;
  allowDirtyGitState: boolean;
};

const flagDefs = new Map<string, { type: "string" | "boolean"; description: string }>([
  [
    "app-url",
    {
      type: "string",
      description:
        "Your frontend app URL (e.g. 'http://localhost:5173' for dev, 'https://myapp.com' for prod)",
    },
  ],
  [
    "variables",
    {
      type: "string",
      description: "Configure additional variables for interactive configuration.",
    },
  ],
  [
    "skip-git-check",
    {
      type: "boolean",
      description: "Don't warn when running outside a Git checkout.",
    },
  ],
  [
    "allow-dirty-git-state",
    {
      type: "boolean",
      description: "Don't warn when Git state is not clean.",
    },
  ],
  ["url", { type: "string", description: "Convex deployment URL." }],
  [
    "site-url",
    {
      type: "string",
      description: "Convex HTTP actions URL (required when it cannot be derived).",
    },
  ],
  ["admin-key", { type: "string", description: "Convex admin key." }],
  [
    "prod",
    {
      type: "boolean",
      description: "Set environment variables on this project's production deployment.",
    },
  ],
  ["deployment", { type: "string", description: "Target a Convex deployment selector." }],
  ["help", { type: "boolean", description: "Show this help message." }],
  ["version", { type: "boolean", description: "Show version." }],
]);

function printHelp() {
  printBanner();
  console.log("  Add code and set environment variables for @estifanos-sh/convex-auth.\n");
  console.log("  Full docs: https://estifanos.sh/convex-auth");
  console.log("  Agent skills: npx skills add estifanos-sh/convex-auth --all\n");
  console.log("  Commands:\n");
  console.log("    setup                         Scaffold files and set env vars");
  console.log("    doctor                        Verify env, files, and mounted auth endpoints");
  console.log("    urls                          Print auth endpoint and provider callback URLs");
  console.log("    keys                          Generate signing/encryption keys\n");
  console.log("  Options:\n");
  for (const [name, def] of flagDefs) {
    const flag = def.type === "boolean" ? `--${name}` : `--${name} <value>`;
    console.log(`    ${flag.padEnd(32)} ${def.description}`);
  }
  console.log();
}

/** @internal */
export function parseCliOptions(argv: string[]): CliOptions {
  let parsed: ReturnType<typeof parseNodeArgs>;
  try {
    parsed = parseNodeArgs({
      args: argv.slice(2),
      options: Object.fromEntries(
        [...flagDefs].map(([name, definition]) => [name, { type: definition.type }]),
      ),
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    logErrorAndExit(error instanceof Error ? error.message : String(error));
  }

  const [commandName, ...extraPositionals] = parsed.positionals;
  const knownCommands = new Set<CliOptions["command"]>(["setup", "doctor", "urls", "keys"]);
  if (commandName !== undefined && !knownCommands.has(commandName as CliOptions["command"])) {
    logErrorAndExit(`Unknown command: ${commandName}`);
  }
  if (extraPositionals.length > 0) {
    logErrorAndExit(`Unexpected arguments: ${extraPositionals.join(" ")}`);
  }

  if (parsed.values.help === true) {
    printHelp();
    process.exit(0);
  }
  if (parsed.values.version === true) {
    console.log(version);
    process.exit(0);
  }

  const stringValue = (name: string) => {
    const value = parsed.values[name];
    return typeof value === "string" ? value : undefined;
  };

  return {
    command: (commandName as CliOptions["command"] | undefined) ?? "setup",
    appUrl: stringValue("app-url"),
    variables: stringValue("variables"),
    skipGitCheck: parsed.values["skip-git-check"] === true,
    allowDirtyGitState: parsed.values["allow-dirty-git-state"] === true,
    url: stringValue("url"),
    siteUrl: stringValue("site-url"),
    adminKey: stringValue("admin-key"),
    prod: parsed.values.prod === true,
    deployment: stringValue("deployment"),
  };
}

function validateDeploymentSelectionOptions(options: CliOptions) {
  const selectionCount = [
    options.url !== undefined,
    options.prod,
    options.deployment !== undefined,
  ].filter(Boolean).length;
  if (selectionCount > 1) {
    logErrorAndExit("Choose only one of --url, --prod, or --deployment.");
  }
}

function handleCancel(value: unknown): asserts value is Exclude<typeof value, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled.");
    process.exit(1);
  }
}

async function runSetup(options: CliOptions) {
  validateDeploymentSelectionOptions(options);

  printBanner();
  p.intro("Starting configuration wizard...");

  await checkSourceControl(options);

  const packageJson = readPackageJson();
  const convexJson = readConvexJson();
  const deployment = readConvexDeployment(options);
  const convexFolderPath = convexJson.functions ?? "convex";

  const isNextjs = !!packageJson.dependencies?.next;
  const usesTypeScript = !!(
    packageJson.dependencies?.typescript || packageJson.devDependencies?.typescript
  );
  const isVite = !!(packageJson.dependencies?.vite || packageJson.devDependencies?.vite);
  const isExpo = !!(packageJson.dependencies?.expo || packageJson.devDependencies?.expo);
  const config: ProjectConfig = {
    isNextjs,
    isVite,
    isExpo,
    usesTypeScript,
    convexFolderPath,
    deployment,
    step: 1,
  };

  await configureAppUrl(config, options.appUrl);
  await configureKeys(config);
  await modifyTsConfig(config);
  for (const file of SCAFFOLDED_FILES) {
    await scaffoldFile({ config, ...file });
  }

  if (options.variables !== undefined) {
    await configureOtherVariables(config, options.variables);
  } else {
    printFinalSuccessMessage(config);
  }

  p.outro("Done! Happy building.");
}

async function runDoctor(options: CliOptions) {
  validateDeploymentSelectionOptions(options);
  printBanner();
  p.intro("Checking Convex Auth setup...");
  const convexJson = readConvexJson();
  const convexFolderPath = convexJson.functions ?? "convex";
  const configPath = existingNonEmptySourcePath(path.join(convexFolderPath, "convex.config"));
  const authPath = existingNonEmptySourcePath(path.join(convexFolderPath, "auth"));
  const authConfigPath = existingNonEmptySourcePath(path.join(convexFolderPath, "auth.config"));
  let healthy = true;

  if (configPath === null) {
    healthy = false;
    p.log.warn("Missing convex.config.ts/js.");
  } else p.log.success(`Found ${configPath}`);
  if (authPath === null) {
    healthy = false;
    p.log.warn("Missing auth.ts/js.");
  } else p.log.success(`Found ${authPath}`);
  if (authConfigPath === null) {
    healthy = false;
    p.log.warn("Missing auth.config.ts/js.");
  } else p.log.success(`Found ${authConfigPath}`);

  const deployment = readConvexDeployment(options);
  const config: ProjectConfig = {
    isExpo: false,
    isNextjs: false,
    isVite: false,
    usesTypeScript: true,
    convexFolderPath,
    deployment,
    step: 1,
  };
  for (const name of ["AUTH_KEYS", "APP_URL"]) {
    if (hasBackendEnvVar(config, name)) p.log.success(`${name} is configured.`);
    else {
      healthy = false;
      p.log.warn(`${name} is missing or unreadable.`);
    }
  }

  const siteUrl = resolveConvexSiteUrl(deployment);
  if (siteUrl === null) {
    healthy = false;
    p.log.warn("Could not derive the HTTP actions URL. Pass --site-url.");
  } else {
    const authSiteUrl = `${siteUrl}/auth`;
    healthy =
      (await checkAuthEndpoint(
        `${authSiteUrl}/.well-known/openid-configuration`,
        "OpenID configuration",
      )) && healthy;
    healthy = (await checkAuthEndpoint(`${authSiteUrl}/.well-known/jwks.json`, "JWKS")) && healthy;
  }

  if (!healthy) process.exitCode = 1;
  p.outro(healthy ? "Convex Auth is healthy." : "Convex Auth needs attention.");
}

async function checkAuthEndpoint(url: string, label: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
    });
    if (!response.ok) {
      p.log.warn(`${label} returned HTTP ${response.status}: ${url}`);
      return false;
    }
    await response.json();
    p.log.success(`${label} is reachable.`);
    return true;
  } catch (error) {
    p.log.warn(
      `${label} is unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

async function runUrls(options: CliOptions) {
  validateDeploymentSelectionOptions(options);
  printBanner();
  const deployment = readConvexDeployment(options);
  const convexSiteUrl = resolveConvexSiteUrl(deployment);
  if (convexSiteUrl === null) {
    logErrorAndExit("Could not derive the HTTP actions URL. Pass --site-url.");
  }
  const authSiteUrl = `${convexSiteUrl.replace(/\/$/, "")}/auth`;
  p.log.info("Convex Auth URLs:");
  p.log.message(
    [
      `Issuer: ${authSiteUrl}`,
      `OpenID configuration: ${authSiteUrl}/.well-known/openid-configuration`,
      `JWKS: ${authSiteUrl}/.well-known/jwks.json`,
      `OAuth sign-in base: ${authSiteUrl}/signin/<provider>`,
      `OAuth callback base: ${authSiteUrl}/callback/<provider>`,
      `Connection connections base: ${authSiteUrl}/connections/<connectionId>`,
    ].join("\n"),
  );
}

async function runKeys(options: CliOptions) {
  validateDeploymentSelectionOptions(options);
  printBanner();
  const convexJson = readConvexJson();
  const deployment = readConvexDeployment(options);
  await configureKeys({
    isExpo: false,
    isNextjs: false,
    isVite: false,
    usesTypeScript: true,
    convexFolderPath: convexJson.functions ?? "convex",
    deployment,
    step: 1,
  });
}

/**
 * Run the interactive Convex Auth setup wizard.
 *
 * Parses CLI flags, detects the target Convex deployment, configures required
 * environment variables, and scaffolds the expected auth files in the current
 * project.
 *
 * @param argv - Process arguments. Defaults to `process.argv`.
 * @returns A promise that resolves when setup completes successfully.
 */
const runCli = async (argv = process.argv) => {
  const options = parseCliOptions(argv);
  if (options.command === "setup") await runSetup(options);
  else if (options.command === "doctor") await runDoctor(options);
  else if (options.command === "urls") await runUrls(options);
  else if (options.command === "keys") await runKeys(options);
};

/**
 * Run the Convex Auth CLI and exit the process on failure.
 *
 * @param argv - Process arguments. Defaults to `process.argv`.
 */
export function runCliMain(argv = process.argv) {
  runCli(argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

type ProjectConfig = {
  isExpo: boolean;
  isNextjs: boolean;
  isVite: boolean;
  usesTypeScript: boolean;
  convexFolderPath: string;
  deployment: ConvexDeployment;
  step: number;
};

async function configureAppUrl(config: ProjectConfig, forcedValue?: string) {
  logStep(config, "Configure APP_URL");
  const value =
    config.deployment.type === "dev" || config.deployment.type === null
      ? config.isVite
        ? "http://localhost:5173"
        : "http://localhost:3000"
      : undefined;
  const description =
    config.deployment.type === "dev"
      ? "the URL of your local web server (e.g. http://localhost:1234)"
      : "the URL where your site is hosted (e.g. https://example.com)";

  await configureEnvVar(config, {
    name: "APP_URL",
    default: value,
    description,
    validate: (input: string | undefined) => {
      if (!input || input.trim() === "") {
        return "URL is required";
      }
      try {
        new URL(input);
        return undefined;
      } catch {
        return "The URL must start with http:// or https://";
      }
    },
    forcedValue,
  });
}

async function configureEnvVar(
  config: ProjectConfig,
  variable: {
    name: string;
    default?: string;
    description: string;
    validate?: (input: string | undefined) => string | undefined;
    forcedValue?: string;
  },
) {
  if (variable.forcedValue) {
    if (variable.validate) {
      const err = variable.validate(variable.forcedValue);
      if (err) {
        logErrorAndExit(`Invalid value for ${variable.name}: ${err}`);
      }
    }
    if (variable.forcedValue.trim() === "") {
      return;
    }
    await setEnvVar(config, variable.name, variable.forcedValue);
    return;
  }

  const existing = backendEnvVar(config, variable.name);
  if (existing !== "") {
    const shouldChange = await p.confirm({
      message: `${variable.name} is already set to "${existing}" on ${printDeployment(config)}. Change it?`,
      initialValue: false,
    });
    handleCancel(shouldChange);
    if (!shouldChange) {
      return;
    }
  }

  const rawValue = await p.text({
    message: `Enter ${variable.description}`,
    placeholder: variable.default,
    defaultValue: variable.default,
    validate: variable.validate,
  });
  handleCancel(rawValue);
  const chosenValue = rawValue as string;

  if (chosenValue.trim() === "") {
    return;
  }
  await setEnvVar(config, variable.name, chosenValue);
}

async function configureKeys(config: ProjectConfig) {
  logStep(config, "Configure signing and encryption keys");
  const existingKeyring = backendEnvVar(config, "AUTH_KEYS");
  if (existingKeyring !== "") {
    const shouldOverwrite = await p.confirm({
      message: `${printDeployment(config)} already has AUTH_KEYS. Replace it? Existing encrypted auth secrets may need to be reconfigured.`,
      initialValue: false,
    });
    handleCancel(shouldOverwrite);
    if (!shouldOverwrite) {
      return;
    }
  }

  const s = p.spinner();
  s.start("Generating keys...");
  const { AUTH_KEYS } = await generateKeys();
  s.stop("Keys generated.");

  const s2 = p.spinner();
  s2.start("Setting keys on deployment...");
  await setEnvVarFromFile(config, "AUTH_KEYS", AUTH_KEYS);
  s2.stop("Keys configured.");
}

function backendEnvVar(config: ProjectConfig, name: string): string {
  const { file, args } = convexCommand("env", "get", ...deploymentArgs(config), name);
  const output = execFileSync(file, args, {
    stdio: "pipe",
    encoding: "utf-8",
  });
  return stripTrailingLineBreak(output);
}

/** @internal */
export function stripTrailingLineBreak(output: string): string {
  return output.replace(/\r?\n$/, "");
}

function hasBackendEnvVar(config: ProjectConfig, name: string): boolean {
  try {
    return backendEnvVar(config, name).trim() !== "";
  } catch {
    return false;
  }
}

async function setEnvVar(
  config: ProjectConfig,
  name: string,
  value: string,
  options?: { hideValue: boolean },
) {
  const { file, args } = convexCommand("env", "set", ...deploymentArgs(config), "--", name, value);
  execFileSync(file, args, {
    stdio: options?.hideValue ? "ignore" : "inherit",
  });
  if (options?.hideValue) {
    p.log.success(`Set ${name} on ${printDeployment(config)}`);
  }
}

async function setEnvVarFromFile(config: ProjectConfig, name: string, value: string) {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "convex-auth-"));
  const tmpFile = path.join(tmpDir, `${name}.tmp`);
  try {
    writeFileSync(tmpFile, value, { encoding: "utf8", mode: 0o600 });
    const { file, args } = convexCommand(
      "env",
      "set",
      ...deploymentArgs(config),
      name,
      "--from-file",
      tmpFile,
    );
    execFileSync(file, args, { stdio: "ignore" });
    p.log.success(`Set ${name} on ${printDeployment(config)}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function deploymentArgs(config: ProjectConfig): string[] {
  const {
    deployment: {
      options: { adminKey, url, prod, deployment },
    },
  } = config;
  const args: string[] = [];

  if (adminKey !== undefined) {
    args.push("--admin-key", adminKey);
  }

  const selectionArgs =
    [
      url ? ["--url", url] : null,
      prod ? ["--prod"] : null,
      deployment ? ["--deployment", deployment] : null,
    ].find((s): s is string[] => s !== null) ?? [];

  args.push(...selectionArgs);
  return args;
}

function printDeployment(config: ProjectConfig): string {
  const { name, type } = config.deployment;
  return (type !== null ? `${type} ` : "") + "deployment" + (name !== null ? ` ${name}` : "");
}

const compilerOptionsPattern =
  /("compilerOptions"\s*:\s*\{(?:\s*(?:\/\*(?:[^*]|\*(?!\/))*\*\/))*(\s*))(?=")/;

const validTsConfig = `\
{
  /* This TypeScript project config describes the environment that
   * Convex functions run in and is used to typecheck them.
   * You can modify it, but some settings required to use Convex.
   */
  "compilerOptions": {
    /* These settings are not required by Convex and can be modified. */
    "allowJs": true,
    "strict": true,
    "skipLibCheck": true,
    "jsx": "react",

    /* These compiler options are required by Convex */
    "target": "ESNext",
    "lib": ["ES2021", "dom", "ES2023.Array"],
    "forceConsistentCasingInFileNames": true,
    "allowSyntheticDefaultImports": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["./**/*"],
  "exclude": ["./_generated"]
}
`;

async function modifyTsConfig(config: ProjectConfig) {
  logStep(config, "Update tsconfig file");
  const projectLevelTsConfigPath = "tsconfig.json";
  const tsConfigPath = path.join(config.convexFolderPath, "tsconfig.json");
  if (!existsSync(tsConfigPath)) {
    if (existsSync(projectLevelTsConfigPath)) {
      if (config.isExpo) {
        writeFileSync(tsConfigPath, validTsConfig);
        p.log.success(`Added ${tsConfigPath}`);
        return;
      }
    }
    p.log.info(`No ${tsConfigPath} found. Skipping.`);
    return;
  }
  const existingTsConfig = readFileSync(tsConfigPath, "utf8");
  const moduleResolutionPattern = /"moduleResolution"\s*:\s*"(\w+)"/;
  const [, existingModuleResolution] = existingTsConfig.match(moduleResolutionPattern) ?? [];
  const skipLibCheckPattern = /"skipLibCheck"\s*:\s*(\w+)/;
  const [, existingSkipLibCheck] = existingTsConfig.match(skipLibCheckPattern) ?? [];
  if (/Bundler/i.test(existingModuleResolution) && existingSkipLibCheck === "true") {
    p.log.success(`${tsConfigPath} is already set up.`);
    return;
  }

  if (!compilerOptionsPattern.test(existingTsConfig)) {
    p.log.info(`Update your ${tsConfigPath} to include the following:`);
    p.log.message(indent(`\n"moduleResolution": "Bundler",\n"skipLibCheck": true\n`));
    const ready = await p.confirm({ message: "Ready to continue?" });
    handleCancel(ready);
    if (!ready) {
      p.cancel("Setup cancelled.");
      process.exit(1);
    }
  }
  const changedTsConfig = addCompilerOption(
    addCompilerOption(
      existingTsConfig,
      existingModuleResolution,
      moduleResolutionPattern,
      '"moduleResolution": "Bundler"',
    ),
    existingSkipLibCheck,
    skipLibCheckPattern,
    '"skipLibCheck": true',
  );
  writeFileSync(tsConfigPath, changedTsConfig);
  p.log.success(`Modified ${tsConfigPath}`);
}

function addCompilerOption(
  tsconfig: string,
  existingValue: string | undefined,
  pattern: RegExp,
  optionAndValue: string,
) {
  if (existingValue === undefined) {
    return tsconfig.replace(compilerOptionsPattern, `$1${optionAndValue},$2`);
  } else {
    return tsconfig.replace(pattern, optionAndValue);
  }
}

type ScaffoldedFile = {
  step: string;
  basename: string;
  sourceTemplate: string;
  guidance: string;
};

/**
 * `sourceTemplate` does double duty: `$$` markers are stripped to produce the
 * file that gets written, and become `.*` wildcards in the "already set up?"
 * match. Editing a template changes both.
 */
const SCAFFOLDED_FILES: readonly ScaffoldedFile[] = [
  {
    step: "Configure convex config file",
    basename: "convex.config",
    guidance: "registers the auth component",
    sourceTemplate: `\
import { defineApp } from "convex/server";
import auth from "@estifanos-sh/convex-auth/convex.config";

const app = defineApp();

app.use(auth);

export default app;
`,
  },
  {
    step: "Initialize auth file",
    basename: "auth",
    guidance: "initializes auth with defineAuth",
    sourceTemplate: `\
import { defineAuth } from "@estifanos-sh/convex-auth/server";
import { components } from "./_generated/api";

const auth = defineAuth(components.auth, {$$
  providers: [$$],$$
});

export { auth };
export const { signIn, signOut, store } = auth;
`,
  },
  {
    step: "Initialize HTTP auth routes",
    basename: "http",
    guidance: "mounts Convex Auth protocol routes",
    sourceTemplate: `\
import { auth } from "./auth";

export default auth.http();
`,
  },
  {
    step: "Initialize auth.config file",
    basename: "auth.config",
    guidance: "trusts env.CONVEX_SITE_URL as the Convex auth issuer",
    sourceTemplate: `\
import { env } from "./_generated/server";$$
$$
export default {$$
  providers: [$$
    {$$
      domain: \`\${env.CONVEX_SITE_URL}/auth\`,$$
      applicationID: "convex",$$
    },$$
  ],$$
};
`,
  },
];

async function scaffoldFile({
  config,
  step,
  basename,
  sourceTemplate,
  guidance,
}: ScaffoldedFile & { config: ProjectConfig }) {
  logStep(config, step);
  const source = templateToSource(sourceTemplate);
  const targetPath = path.join(config.convexFolderPath, basename);
  const existingPath = existingNonEmptySourcePath(targetPath);
  if (existingPath !== null) {
    const existing = readFileSync(existingPath, "utf8");
    if (doesAlreadyMatchTemplate(existing, sourceTemplate)) {
      p.log.success(`${existingPath} is already set up.`);
    } else {
      p.log.info(`You already have ${existingPath}. Make sure it ${guidance}:`);
      p.log.message(indent(`\n${source}\n`));
      const ready = await p.confirm({ message: "Ready to continue?" });
      handleCancel(ready);
      if (!ready) {
        p.cancel("Setup cancelled.");
        process.exit(1);
      }
    }
  } else {
    const newPath = config.usesTypeScript ? `${targetPath}.ts` : `${targetPath}.js`;
    writeFileSync(newPath, source);
    p.log.success(`Created ${newPath}`);
  }
}

type VariableEntry = {
  name: string;
  description: string;
};

type ProviderEntry = {
  name: string;
  help?: string;
  variables: VariableEntry[];
};

type VariablesConfig = {
  help?: string;
  providers: ProviderEntry[];
  success?: string;
};

function validateVariablesConfig(value: unknown): VariablesConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an object at the top level.");
  }
  const obj = value as Record<string, unknown>;

  if (obj.help !== undefined && typeof obj.help !== "string") {
    throw new Error("'help' must be a string if present.");
  }
  if (obj.success !== undefined && typeof obj.success !== "string") {
    throw new Error("'success' must be a string if present.");
  }
  if (!Array.isArray(obj.providers)) {
    throw new Error("'providers' must be an array.");
  }

  const providers: ProviderEntry[] = [];
  for (const provider of obj.providers) {
    if (typeof provider !== "object" || provider === null) {
      throw new Error("Each provider must be an object.");
    }
    const prov = provider as Record<string, unknown>;
    if (typeof prov.name !== "string") {
      throw new Error("Each provider must have a 'name' string.");
    }
    if (prov.help !== undefined && typeof prov.help !== "string") {
      throw new Error("Provider 'help' must be a string if present.");
    }
    if (!Array.isArray(prov.variables)) {
      throw new Error("Each provider must have a 'variables' array.");
    }
    const variables: VariableEntry[] = [];
    for (const v of prov.variables) {
      if (typeof v !== "object" || v === null) {
        throw new Error("Each variable must be an object.");
      }
      const variable = v as Record<string, unknown>;
      if (typeof variable.name !== "string") {
        throw new Error("Each variable must have a 'name' string.");
      }
      if (typeof variable.description !== "string") {
        throw new Error("Each variable must have a 'description' string.");
      }
      variables.push({
        name: variable.name,
        description: variable.description,
      });
    }
    providers.push({
      name: prov.name,
      help: prov.help as string | undefined,
      variables,
    });
  }

  return {
    help: obj.help as string | undefined,
    providers,
    success: obj.success as string | undefined,
  };
}

async function configureOtherVariables(config: ProjectConfig, json: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    logErrorAndExit(
      "The --variables flag must be valid JSON.",
      err instanceof Error ? err.message : String(err),
    );
  }

  let variables: VariablesConfig;
  try {
    variables = validateVariablesConfig(parsed);
  } catch (err) {
    logErrorAndExit(
      "The --variables flag has an invalid shape.",
      err instanceof Error ? err.message : String(err),
    );
  }
  logStep(config, "Configure extra environment variables");
  if (variables.help !== undefined) {
    p.log.message(variables.help);
  }
  for (const provider of variables.providers) {
    const shouldConfigure = await p.confirm({
      message: `Configure ${provider.name}?`,
    });
    handleCancel(shouldConfigure);
    if (!shouldConfigure) {
      continue;
    }
    if (provider.help !== undefined) {
      p.log.message(provider.help);
    }
    for (const variable of provider.variables) {
      await configureEnvVar(config, {
        name: variable.name,
        description: variable.description,
      });
    }
  }
  if (variables.success !== undefined) {
    p.log.success(variables.success);
  }
}

/** @internal */
export function doesAlreadyMatchTemplate(existing: string, template: string) {
  const regex = new RegExp(
    template
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\$\\\$/g, ".*")
      .replace(/;\n/g, ";.*"),
    "s",
  );
  return regex.test(existing);
}

/** @internal */
export function templateToSource(template: string) {
  return template.replace(/\$\$/g, "");
}

function existingNonEmptySourcePath(filePath: string): string | null {
  return existsAndNotEmpty(`${filePath}.ts`)
    ? `${filePath}.ts`
    : existsAndNotEmpty(`${filePath}.js`)
      ? `${filePath}.js`
      : null;
}

function existsAndNotEmpty(filePath: string): boolean {
  return existsSync(filePath) && readFileSync(filePath, "utf8").trim() !== "";
}

function logStep(config: ProjectConfig, message: string) {
  p.log.step(`Step ${config.step++}: ${message}`);
}

async function checkSourceControl(options: {
  skipGitCheck?: boolean;
  allowDirtyGitState?: boolean;
}) {
  if (options.allowDirtyGitState) {
    return;
  }
  const isGit = existsSync(".git");
  if (isGit) {
    let gitStatus: string;
    try {
      gitStatus = execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf-8",
      });
    } catch {
      return;
    }
    const changedFiles = gitStatus
      .split("\n")
      .filter(
        (line) =>
          !/\bpackage(-lock)?.json/.test(line) && !/\benv\.d\.ts$/.test(line) && line.length > 0,
      );
    if (changedFiles.length > 0) {
      p.log.warn("There are unstaged or uncommitted changes in the working directory.");
      const cont = await p.confirm({
        message: "Continue anyway?",
        initialValue: false,
      });
      handleCancel(cont);
      if (!cont) {
        p.cancel("Setup cancelled.");
        process.exit(1);
      }
    }
  } else {
    if (options.skipGitCheck) {
      return;
    }
    p.log.warn("No source control detected. We recommend committing your current state first.");
    const cont = await p.confirm({ message: "Continue anyway?" });
    handleCancel(cont);
    if (!cont) {
      p.cancel("Setup cancelled.");
      process.exit(1);
    }
  }
}

type PackageJSON = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} & Record<string, unknown>;

function readPackageJson(): PackageJSON {
  try {
    const data = readFileSync("package.json", "utf8");
    return JSON.parse(data);
  } catch (error: unknown) {
    logErrorAndExit(
      "`@estifanos-sh/convex-auth` must be run from a project directory which " +
        'includes a valid "package.json" file. You can create one by running ' +
        "`npm init`.",
      error instanceof Error ? error.message : String(error),
    );
  }
}

type ConvexJSON = {
  functions?: string;
} & Record<string, unknown>;

function readConvexJson(): ConvexJSON {
  if (!existsSync("convex.json")) {
    return {} as ConvexJSON;
  }
  try {
    const data = readFileSync("convex.json", "utf8");
    return JSON.parse(data);
  } catch (error: unknown) {
    logErrorAndExit(
      "Could not parse your convex.json. Is it valid JSON?",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function loadEnvFiles() {
  loadEnvFile({ path: ".env.local", override: false });
  loadEnvFile({ path: ".env", override: false });
}

/** @internal */
export function readConvexDeployment(options: {
  url?: string;
  siteUrl?: string;
  adminKey?: string;
  prod?: boolean;
  deployment?: string;
}): ConvexDeployment {
  const { adminKey, url, prod, deployment } = options;

  if (url) {
    return { name: url, type: null, options };
  }

  const adminKeyName = adminKey ? deploymentNameFromAdminKey(adminKey) : null;
  const adminKeyType = adminKey ? deploymentTypeFromAdminKey(adminKey) : null;
  const deploymentType =
    adminKeyType ??
    (deployment === "prod"
      ? "prod"
      : deployment === "dev" || deployment === "local"
        ? "dev"
        : null);

  const explicitSelection = [
    prod ? { name: adminKeyName, type: "prod" as const } : null,
    deployment ? { name: deployment, type: deploymentType } : null,
    adminKey ? { name: adminKeyName, type: adminKeyType } : null,
  ].find(
    (
      selection,
    ): selection is {
      name: string | null;
      type: ConvexDeployment["type"];
    } => selection !== null,
  );

  if (explicitSelection !== undefined) {
    return { ...explicitSelection, options };
  }

  loadEnvFiles();
  if (process.env.CONVEX_DEPLOYMENT) {
    const type = getDeploymentTypeFromConfiguredDeployment(process.env.CONVEX_DEPLOYMENT);
    return {
      name: stripDeploymentTypePrefix(process.env.CONVEX_DEPLOYMENT),
      type,
      options,
    };
  }

  logErrorAndExit(
    "Could not find a configured CONVEX_DEPLOYMENT. Did you forget to run `npx convex dev` first?",
  );
}

/** @internal */
export function resolveConvexSiteUrl(deployment: ConvexDeployment): string | null {
  const explicitSiteUrl = deployment.options.siteUrl;
  if (explicitSiteUrl !== undefined) {
    return normalizedHttpUrl(explicitSiteUrl);
  }

  const cloudUrl = deployment.options.url;
  if (cloudUrl !== undefined) {
    const parsed = new URL(cloudUrl);
    if (parsed.hostname.endsWith(".convex.cloud")) {
      parsed.hostname = `${parsed.hostname.slice(0, -".convex.cloud".length)}.convex.site`;
    } else if (
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
      parsed.port === "3210"
    ) {
      parsed.port = "3211";
    }
    return parsed.toString().replace(/\/$/, "");
  }

  if (deployment.name !== null && /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(deployment.name)) {
    return `https://${deployment.name}.convex.site`;
  }
  return null;
}

function normalizedHttpUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    logErrorAndExit("Invalid --site-url.", "Expected an HTTP or HTTPS URL.");
  }
  return parsed.toString().replace(/\/$/, "");
}

/** @internal */
export function stripDeploymentTypePrefix(deployment: string) {
  const [type, name] = deployment.split(":");
  if ((type !== "prod" && type !== "dev" && type !== "preview") || !name) {
    logErrorAndExit(
      "Invalid CONVEX_DEPLOYMENT.",
      'Expected a typed deployment like "dev:my-deployment", "prod:my-deployment", or "preview:my-deployment".',
    );
  }
  return name;
}

function getDeploymentTypeFromConfiguredDeployment(raw: string) {
  const typeRaw = raw.split(":")[0];
  if (typeRaw === "prod" || typeRaw === "dev" || typeRaw === "preview") {
    return typeRaw;
  }
  logErrorAndExit(
    "Invalid CONVEX_DEPLOYMENT.",
    'Expected a typed deployment like "dev:my-deployment", "prod:my-deployment", or "preview:my-deployment".',
  );
}

function deploymentNameFromAdminKey(adminKey: string) {
  const parts = adminKey.split("|");
  const hasDeployment = parts.length > 1;
  return hasDeployment && !isPreviewDeployKey(adminKey)
    ? stripDeploymentTypePrefix(parts[0])
    : null;
}

/** @internal */
export function deploymentTypeFromAdminKey(adminKey: string) {
  const type = adminKey.split(":")[0];
  if (type === "prod" || type === "dev" || type === "preview") {
    return type;
  }
  logErrorAndExit(
    "Invalid admin key.",
    'Expected a typed key like "dev:deployment|...", "prod:deployment|...", or "preview:...".',
  );
}

/** @internal */
export function isPreviewDeployKey(adminKey: string) {
  const parts = adminKey.split("|");
  if (parts.length === 1) {
    return false;
  }
  const [prefix] = parts;
  const prefixParts = prefix.split(":");
  return prefixParts[0] === "preview" && prefixParts.length === 3;
}

function printFinalSuccessMessage(config: ProjectConfig) {
  const isProd = config.deployment.type === "prod";
  const deploymentName = config.deployment.name ?? "your deployment";

  if (isProd) {
    p.log.success(`Production setup complete for ${deploymentName}.`);
    p.note(
      [
        "Full docs: https://estifanos.sh/convex-auth",
        "Agent skills: npx skills add estifanos-sh/convex-auth --all",
      ].join("\n"),
    );
  } else {
    p.log.success(`Setup complete for ${deploymentName}.`);
    p.note(
      [
        "To set up production, run:",
        '  npx @estifanos-sh/convex-auth --prod --app-url "https://myapp.com"',
        "",
        "Declare provider secrets in convex.config.ts, set them on production,",
        "and pass the generated env values to each provider.",
        "",
        "Full docs: https://estifanos.sh/convex-auth",
        "Agent skills: npx skills add estifanos-sh/convex-auth --all",
      ].join("\n"),
      "Next steps",
    );
  }
}

function logErrorAndExit(message: string, error?: string): never {
  p.log.error(`${message}${error !== undefined ? `\n  ${error}` : ""}`);
  process.exit(1);
}

function indent(string: string) {
  return string.replace(/^/gm, "  ").slice(2);
}
