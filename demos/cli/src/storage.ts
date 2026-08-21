import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const CONFIG_DIR = path.join(homedir(), ".config", "convex-auth-demo");
const STORAGE_PATH = path.join(CONFIG_DIR, "auth.json");

type StorageShape = {
  token?: string;
  refreshToken?: string;
};
export type SessionShape = {
  token: string;
  refreshToken?: string;
};

function isStorageShape(value: unknown): value is StorageShape {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (!("token" in value) || typeof value.token === "string") &&
    (!("refreshToken" in value) || typeof value.refreshToken === "string")
  );
}

async function readStorage(): Promise<StorageShape> {
  try {
    const raw = await readFile(STORAGE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isStorageShape(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeStorage(data: StorageShape) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(STORAGE_PATH, JSON.stringify(data, null, 2));
}

export async function clearStoredSession() {
  await rm(STORAGE_PATH, { force: true });
}

export async function readStoredSession(): Promise<SessionShape | null> {
  const data = await readStorage();
  if (typeof data.token !== "string" || data.token.length === 0) {
    return null;
  }
  const session: SessionShape = { token: data.token };
  if (data.refreshToken) session.refreshToken = data.refreshToken;
  return session;
}

export async function writeStoredSession(session: SessionShape) {
  const data: StorageShape = { token: session.token };
  if (session.refreshToken) data.refreshToken = session.refreshToken;
  await writeStorage(data);
}
