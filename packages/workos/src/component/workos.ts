/**
 * WorkOS's REST API, as this package calls it: the one owner of the API key,
 * of every request, and of decoding every answer.
 *
 * @module
 */
import type { Infer, Validator } from "convex/values";
import { v } from "convex/values";
import { fetchRefusingRedirects } from "@convex-dev/auth/lib/oauth/callback";
import { decode } from "./decode.ts";
import {
  EVENTS,
  type Intent,
  vConnection,
  vDirectory,
  vDirectoryGroup,
  vDirectoryUser,
  vList,
  vOrganizationPayload,
  vWorkosEvent,
  type WorkosEvent,
} from "./validators.ts";

/** WorkOS's REST API. */
export const API_BASE = "https://api.workos.com";

/** The most objects or events WorkOS returns in one page. */
export const PAGE_SIZE = 100;

/**
 * A call WorkOS refused. The message carries WorkOS's error code and
 * nothing else: an error body can carry a user's email, and this ends up in
 * logs.
 */
export class WorkosError extends Error {
  override readonly name = "WorkosError";

  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`WorkOS answered ${status}: ${code}`);
  }
}

/** One page of a listing, and the cursor of the next one, if there is one. */
export type Page<Item> = { data: Item[]; after?: string };

/**
 * Where an events page starts: after an event, or at a time, up to a time.
 * WorkOS takes one of `after` and `range_start`, never both.
 */
export type EventsFrom =
  { after: string } | { range_start: string; range_end?: string };

type Query = Record<string, string | readonly string[] | undefined>;

const vLink = v.object({ link: v.string() });

export class Workos {
  constructor(private readonly apiKey: string) {}

  /** One page of events, oldest first. */
  async events(from: EventsFrom): Promise<WorkosEvent[]> {
    const page = await this.call("GET", "/events", vList(vWorkosEvent), {
      query: { ...from, events: EVENTS, limit: String(PAGE_SIZE) },
    });
    return page.data;
  }

  async organizations(after?: string) {
    return await this.list("/organizations", vOrganizationPayload, { after });
  }

  async connections(after?: string) {
    return await this.list("/connections", vConnection, { after });
  }

  async directories(after?: string) {
    return await this.list("/directories", vDirectory, { after });
  }

  async users(directory: string, after?: string) {
    return await this.list("/directory_users", vDirectoryUser, {
      directory,
      after,
    });
  }

  async groups(directory: string, after?: string) {
    return await this.list("/directory_groups", vDirectoryGroup, {
      directory,
      after,
    });
  }

  /** A short-lived Admin Portal link for one organization. */
  async link(request: {
    organization: string;
    intent: Intent;
    return_url?: string;
    success_url?: string;
  }): Promise<string> {
    const { link } = await this.call("POST", "/portal/generate_link", vLink, {
      body: request,
    });
    return link;
  }

  private async list<Item extends Validator<unknown, "required", string>>(
    path: string,
    item: Item,
    query: Query,
  ): Promise<Page<Infer<Item>>> {
    const page = await this.call("GET", path, vList(item), {
      query: { ...query, limit: String(PAGE_SIZE) },
    });
    return { data: page.data, after: page.list_metadata.after };
  }

  private async call<Answer extends Validator<unknown, "required", string>>(
    method: "GET" | "POST",
    path: string,
    answer: Answer,
    request: { query?: Query; body?: Record<string, unknown> },
  ): Promise<Infer<Answer>> {
    const url = new URL(path, API_BASE);
    for (const [name, value] of Object.entries(request.query ?? {})) {
      if (value === undefined) continue;
      if (typeof value === "string") url.searchParams.set(name, value);
      else for (const item of value) url.searchParams.append(name, item);
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };
    if (request.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const response = await fetchRefusingRedirects(url.toString(), {
      method,
      headers,
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    if (!response.ok) {
      throw new WorkosError(response.status, refusal(response.bodyText));
    }
    let body: unknown;
    try {
      body = response.bodyText === "" ? null : JSON.parse(response.bodyText);
    } catch {
      // A parse error would quote the body, which holds directory data.
      throw new WorkosError(response.status, "the body is not JSON");
    }
    return decode(answer, body);
  }
}

/** The error code of a refusal, which names the refusal and nothing else. */
function refusal(bodyText: string): string {
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
