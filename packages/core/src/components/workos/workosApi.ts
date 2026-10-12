/**
 * WorkOS's REST API, as the directory sync and the admin functions call it.
 *
 * @module
 */
import type { Credentials } from "./credentials.ts";

const BASE = "https://api.workos.com";
// The callback's fetch bound: an unanswered call is a transient fault.
const TIMEOUT_MS = 10_000;

/**
 * How a failed call is handled: `transient` is retried by the lane,
 * `credentials` waits for a new key, `rejected` is recorded, and `expired`
 * restarts the event stream from a fresh boundary.
 */
export type Fault = "transient" | "credentials" | "rejected" | "expired";

export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    readonly fault: Fault,
    readonly status: number,
    detail: string,
  ) {
    super(`WorkOS ${fault} (${String(status)}): ${detail}`);
  }

  static classify(status: number, text: string): ApiError {
    const detail = text.slice(0, 500);
    if (status === 401 || status === 403)
      return new ApiError("credentials", status, detail);
    if (status === 429 || status >= 500)
      return new ApiError("transient", status, detail);
    return new ApiError("rejected", status, detail);
  }
}

export type Reply = { body: unknown; date: number };

type Query = Record<string, string | readonly string[] | undefined>;

// One instance per action: it holds the API key it was opened with, read from the bindings at call
// time, and every failure leaves it as an `ApiError` with one classification.
export class Api {
  constructor(private readonly credentials: Credentials) {}

  get client(): string {
    return this.credentials.clientId;
  }

  async get(path: string, query: Query = {}): Promise<Reply> {
    const url = new URL(path, BASE);
    for (const [name, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (typeof value === "string") url.searchParams.set(name, value);
      else for (const item of value) url.searchParams.append(name, item);
    }
    return await this.call(url, "GET");
  }

  async send(
    method: "POST" | "PUT" | "DELETE",
    path: string,
    body?: object,
  ): Promise<Reply> {
    return await this.call(new URL(path, BASE), method, body);
  }

  // Without a cursor the stream reads forward from a WorkOS time: the live endpoint ignores
  // `order` (workos/workos-node#1610), so the newest event cannot be asked for directly. WorkOS
  // documents no code for a cursor past its retention, so any 4xx refusing a cursor expires it: a
  // restart from a fresh boundary costs one backfill and loses nothing.
  async events(
    names: readonly string[],
    from: { after: string } | { since: number },
    limit: number,
  ): Promise<Reply> {
    try {
      return await this.get("/events", {
        events: names,
        ...("after" in from
          ? { after: from.after }
          : { range_start: new Date(from.since).toISOString() }),
        limit: String(limit),
      });
    } catch (error) {
      if (
        "after" in from &&
        error instanceof ApiError &&
        error.fault === "rejected"
      ) {
        throw new ApiError("expired", error.status, error.message);
      }
      throw error;
    }
  }

  async clock(names: readonly string[]): Promise<number> {
    return (await this.get("/events", { events: names, limit: "1" })).date;
  }

  private async call(url: URL, method: string, body?: object): Promise<Reply> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.credentials.apiKey}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    let text: string;
    try {
      response = await fetch(url, {
        method,
        redirect: "manual",
        signal: controller.signal,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      text = await response.text();
    } catch (error) {
      throw new ApiError("transient", 0, String(error));
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw ApiError.classify(response.status, text);
    const date = Date.parse(response.headers.get("Date") ?? "");
    if (Number.isNaN(date))
      throw new ApiError("transient", response.status, "no Date header");
    return { body: text === "" ? null : JSON.parse(text), date };
  }
}
