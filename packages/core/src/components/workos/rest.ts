/**
 * WorkOS's REST API, as the directory sync and the portal call it, with the
 * environment's API key.
 *
 * @module
 */
import { API_BASE } from "./constants.ts";

const TIMEOUT_MS = 10 * 1000;

/**
 * A call WorkOS refused or never answered. `retryable` is true for a
 * timeout, a 429 or a 5xx, which the next run tries again.
 */
export class WorkosApiError extends Error {
  override readonly name = "WorkosApiError";

  constructor(
    readonly status: number,
    readonly retryable: boolean,
    detail: string,
  ) {
    super(`WorkOS API responded with ${status}: ${detail}`);
  }
}

/** A response body, and WorkOS's clock when it sent it. */
export type WorkosReply = { body: unknown; date: number };

/**
 * The error code of a refusal, and nothing else: an error body can carry the
 * user's email, and this ends up in logs and in the sync's state row.
 */
function refusalCode(bodyText: string): string {
  try {
    const body: unknown = JSON.parse(bodyText);
    if (typeof body === "object" && body !== null) {
      const code =
        "code" in body ? body.code : "error" in body ? body.error : undefined;
      if (typeof code === "string" && /^[a-z_]{1,64}$/.test(code)) {
        return code;
      }
    }
  } catch {
    // Not JSON.
  }
  return "unknown";
}

/** Call WorkOS's API with the API key. Refuses redirects, like the callback. */
export async function callWorkos(
  apiKey: string,
  request: {
    method: "GET" | "POST";
    path: string;
    query?: Record<string, string | readonly string[] | undefined>;
    body?: Record<string, unknown>;
  },
): Promise<WorkosReply> {
  const url = new URL(request.path, API_BASE);
  for (const [name, value] of Object.entries(request.query ?? {})) {
    if (value === undefined) continue;
    if (typeof value === "string") url.searchParams.set(name, value);
    else for (const item of value) url.searchParams.append(name, item);
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
  if (request.body !== undefined) headers["Content-Type"] = "application/json";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, {
      method: request.method,
      headers,
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
      redirect: "manual",
      signal: controller.signal,
    });
    text = await response.text();
  } catch (error) {
    throw new WorkosApiError(0, true, String(error));
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const status = response.status;
    throw new WorkosApiError(
      status,
      status === 429 || status >= 500,
      refusalCode(text),
    );
  }
  const date = Date.parse(response.headers.get("Date") ?? "");
  let body: unknown;
  try {
    body = text === "" ? null : JSON.parse(text);
  } catch {
    // A parse error would quote the body, which holds directory data.
    throw new WorkosApiError(response.status, true, "the body is not JSON");
  }
  return { body, date: Number.isNaN(date) ? Date.now() : date };
}
