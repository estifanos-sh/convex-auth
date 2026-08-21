import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import * as p from "@clack/prompts";
import type { DeviceCodeResult } from "@estifanos-sh/convex-auth/client";
import { ConvexHttpClient } from "convex/browser";
import { config as loadEnvFile } from "dotenv";
import figlet from "figlet";
import ansiShadow from "figlet/importable-fonts/ANSI Shadow.js";
import gradientString from "gradient-string";

import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";
import { clearStoredSession, readStoredSession, writeStoredSession } from "./storage";
import type { SessionShape } from "./storage";

figlet.parseFont("ANSI Shadow", ansiShadow);

const gradient = gradientString("#EE342F", "#F3B01C");

function printBanner() {
  const banner = figlet.textSync("CONVEX-AUTH", {
    font: "ANSI Shadow",
    horizontalLayout: "default",
  });
  console.log("\n" + gradient(banner));
  console.log(
    "  \x1b[38;2;185;177;170m✦  cli demo — device login & direct convex calls  ✦\x1b[0m\n",
  );
}

type StoredSessionSignInResult = {
  kind: "signedIn";
  session: SessionShape | null;
};

class CliExit extends Error {
  constructor(readonly code: number = 0) {
    super("CLI exited.");
  }
}

function exitCli(code = 0): never {
  throw new CliExit(code);
}

function cancelCli(message = "Cancelled."): never {
  p.cancel(message);
  exitCli(0);
}

function unwrapPrompt<T>(value: T | symbol, message?: string): T {
  if (p.isCancel(value)) {
    cancelCli(message);
  }
  return value;
}

function parseProjectId(value: string): Id<"projects"> {
  const projectId = value.trim();
  if (projectId.length === 0) {
    p.log.error("Project ID is required.");
    exitCli(1);
  }
  return projectId as Id<"projects">;
}

function loadCliEnv() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const cliDir = path.resolve(currentDir, "..");
  const repoRoot = path.resolve(cliDir, "..", "..");
  for (const filePath of [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(cliDir, ".env.local"),
    path.join(cliDir, ".env"),
    path.join(repoRoot, "demos", "svelte", ".env.local"),
    path.join(repoRoot, "demos", "svelte", ".env"),
  ]) {
    if (existsSync(filePath)) {
      loadEnvFile({ path: filePath, override: false, quiet: true });
    }
  }
}

loadCliEnv();

function requireConvexUrl() {
  const url = process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) {
    p.log.error("Set VITE_CONVEX_URL or CONVEX_URL before running the CLI demo.");
    exitCli(1);
  }
  return url;
}

function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isDeviceCodeResult(value: unknown): value is DeviceCodeResult {
  return (
    isRecord(value) &&
    "deviceCode" in value &&
    typeof value.deviceCode === "string" &&
    "userCode" in value &&
    typeof value.userCode === "string" &&
    "verificationUri" in value &&
    typeof value.verificationUri === "string" &&
    "verificationUriComplete" in value &&
    typeof value.verificationUriComplete === "string" &&
    "expiresIn" in value &&
    typeof value.expiresIn === "number" &&
    "interval" in value &&
    typeof value.interval === "number"
  );
}

function isStoredSession(value: unknown): value is SessionShape {
  return (
    isRecord(value) &&
    "token" in value &&
    typeof value.token === "string" &&
    (!("refreshToken" in value) || typeof value.refreshToken === "string")
  );
}

function isSignedInResult(value: unknown): value is StoredSessionSignInResult {
  return (
    isRecord(value) &&
    "kind" in value &&
    value.kind === "signedIn" &&
    "session" in value &&
    (value.session === null || isStoredSession(value.session))
  );
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createClient() {
  const url = requireConvexUrl();
  return new ConvexHttpClient(url);
}

async function applyStoredSession(client: ConvexHttpClient) {
  const session = await readStoredSession();
  if (session?.token) {
    client.setAuth(session.token);
  }
}

async function refreshSessionIfNeeded(client: ConvexHttpClient) {
  const session = await readStoredSession();
  if (!session) {
    p.log.error("Not signed in. Run the login command first.");
    exitCli(1);
  }
  client.setAuth(session.token);
  if (!session.refreshToken) {
    return session;
  }
  const result = await client.action(api.auth.signIn, {
    refreshToken: session.refreshToken,
  });
  if (isSignedInResult(result) && result.session) {
    await writeStoredSession(result.session);
    client.setAuth(result.session.token);
    return result.session;
  }
  return session;
}

async function authedClient() {
  const client = createClient();
  await applyStoredSession(client);
  await refreshSessionIfNeeded(client);
  return client;
}

async function doAuthLogin() {
  const client = createClient();

  const s = p.spinner();
  s.start("Starting device login...");
  const result = await client.action(api.auth.signIn, {
    provider: "device",
  });
  if (!isRecord(result) || result.kind !== "deviceCode" || !isDeviceCodeResult(result.deviceCode)) {
    s.stop("Failed.");
    p.log.error("Device sign-in did not return a device code.");
    exitCli(1);
  }
  const code = result.deviceCode;
  s.stop("Device code received.");

  p.note(
    [
      `Code: ${code.userCode}`,
      "",
      `URL:  ${code.verificationUri}`,
      `Full: ${code.verificationUriComplete}`,
    ].join("\n"),
    "Open in your browser",
  );

  const s2 = p.spinner();
  s2.start("Waiting for approval...");

  const deadline = Date.now() + code.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(code.interval * 1000);
    try {
      const pollResult = await client.action(api.auth.signIn, {
        provider: "device",
        params: { flow: "poll", deviceCode: code.deviceCode },
      });
      if (isSignedInResult(pollResult) && pollResult.session) {
        await writeStoredSession(pollResult.session);
        s2.stop("Approved!");
        p.log.success("Login complete. Session stored locally.");
        return;
      }
    } catch (error) {
      if (
        isRecord(error) &&
        "data" in error &&
        isRecord(error.data) &&
        "code" in error.data &&
        (error.data.code === "DEVICE_AUTHORIZATION_PENDING" ||
          error.data.code === "DEVICE_SLOW_DOWN")
      ) {
        continue;
      }
      s2.stop("Failed.");
      throw error;
    }
  }
  s2.stop("Expired.");
  p.log.error("Device code expired before approval completed.");
  exitCli(1);
}

async function doAuthStatus() {
  const client = await authedClient();
  const groups = await client.query(api.groups.list, {});
  p.log.success(`Signed in. ${groups.length} group(s) visible.`);
  if (groups.length > 0) {
    console.log(JSON.stringify(groups, null, 2));
  }
}

async function doAuthLogout() {
  await clearStoredSession();
  p.log.success("Stored credentials cleared.");
}

async function doGroupsList() {
  const client = await authedClient();
  const groups = await client.query(api.groups.list, {});
  console.log(JSON.stringify(groups, null, 2));
}

async function doProjectsList() {
  const client = await authedClient();
  const groupId = await p.text({
    message: "Group ID",
    placeholder: "paste group ID here",
  });
  const selectedGroupId = unwrapPrompt(groupId);
  const result = await client.query(api.projects.list, { groupId: selectedGroupId });
  console.log(JSON.stringify(result, null, 2));
}

async function doProjectsCreate() {
  const client = await authedClient();
  const group = await p.group(
    {
      groupId: () => p.text({ message: "Group ID" }),
      name: () => p.text({ message: "Project name" }),
      identifier: () => p.text({ message: "Project identifier" }),
      description: () => p.text({ message: "Description (optional)", defaultValue: "" }),
    },
    {
      onCancel: () => cancelCli(),
    },
  );
  interface ProjectInput {
    groupId: string;
    name: string;
    identifier: string;
    description?: string;
  }
  const input: ProjectInput = {
    groupId: group.groupId,
    name: group.name,
    identifier: group.identifier,
  };
  if (group.description) input.description = group.description;
  const result = await client.mutation(api.projects.create, input);
  p.log.success("Project created.");
  console.log(JSON.stringify(result, null, 2));
}

async function doIssuesList() {
  const client = await authedClient();
  const projectId = await p.text({
    message: "Project ID",
    placeholder: "paste project ID here",
  });
  const selectedProjectId = unwrapPrompt(projectId);
  const result = await client.query(api.issues.list, {
    projectId: parseProjectId(selectedProjectId),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function doIssuesCreate() {
  const client = await authedClient();
  const issue = await p.group(
    {
      projectId: () => p.text({ message: "Project ID" }),
      title: () => p.text({ message: "Issue title" }),
    },
    {
      onCancel: () => cancelCli(),
    },
  );
  const result = await client.mutation(api.issues.create, {
    projectId: parseProjectId(issue.projectId),
    title: issue.title,
  });
  p.log.success("Issue created.");
  console.log(JSON.stringify(result, null, 2));
}

async function run() {
  printBanner();
  p.intro("convex-auth demo cli");

  const action = await p.select({
    message: "What would you like to do?",
    options: [
      { value: "auth:login", label: "Login", hint: "device code flow" },
      { value: "auth:status", label: "Status", hint: "check current session" },
      { value: "auth:logout", label: "Logout", hint: "clear stored tokens" },
      { value: "groups:list", label: "List groups" },
      { value: "projects:list", label: "List projects" },
      { value: "projects:create", label: "Create project" },
      { value: "issues:list", label: "List issues" },
      { value: "issues:create", label: "Create issue" },
    ],
  });

  if (p.isCancel(action)) {
    cancelCli("Bye!");
  }

  const handlers = new Map<string, () => Promise<void>>([
    ["auth:login", doAuthLogin],
    ["auth:status", doAuthStatus],
    ["auth:logout", doAuthLogout],
    ["groups:list", doGroupsList],
    ["projects:list", doProjectsList],
    ["projects:create", doProjectsCreate],
    ["issues:list", doIssuesList],
    ["issues:create", doIssuesCreate],
  ]);

  const handler = handlers.get(action);
  if (!handler) {
    p.log.error(`Unknown action: ${action}`);
    exitCli(1);
  }
  await handler();

  p.outro("Done!");
}

export function runCliMain() {
  run().catch((err) => {
    if (err instanceof CliExit) {
      process.exit(err.code);
    }
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

runCliMain();
