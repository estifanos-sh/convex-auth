/**
 * Where the copy is in WorkOS's history, and the page that follows. An empty
 * copy fills by listing everything once (organizations with their domains,
 * connections, directories, then each directory's users and groups), each
 * listed object staged as the event that creates it. Then it follows the
 * Events API from the time the listing started, so what changed while it
 * listed is applied again in order, and the copy converges.
 *
 * @module
 */
import { type Infer, v } from "convex/values";
import type { Workos } from "./workos.ts";
import type { WorkosEvent } from "./validators.ts";

/** How far back the Events API answers one query from a time. */
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export const vPosition = v.union(
  v.object({
    step: v.union(
      v.literal("organizations"),
      v.literal("connections"),
      v.literal("directories"),
    ),
    /** When the listing started, where the events take over. */
    since: v.string(),
    after: v.optional(v.string()),
  }),
  /** Before the users of the directory after `after`, in id order. */
  v.object({
    step: v.literal("contents"),
    since: v.string(),
    after: v.optional(v.string()),
  }),
  v.object({
    step: v.union(v.literal("users"), v.literal("groups")),
    since: v.string(),
    directory: v.string(),
    after: v.optional(v.string()),
  }),
  /** The events from `at`, before the copy has applied any. */
  v.object({ step: v.literal("since"), at: v.string() }),
  /** The events after WorkOS's event `id`. */
  v.object({ step: v.literal("after"), id: v.string() }),
);
export type Position = Infer<typeof vPosition>;

/** A page to stage: its events, and the position after them. */
export type Page = { events: WorkosEvent[]; position: Position };

export class Fill {
  constructor(
    private readonly workos: Workos,
    /** The id of the copy's first directory after `after`, in id order. */
    private readonly directory: (after?: string) => Promise<string | null>,
  ) {}

  /** Where an empty copy starts. */
  static start(now: number): Position {
    return { step: "organizations", since: new Date(now).toISOString() };
  }

  /** The page after `at`, or null when WorkOS has nothing newer. */
  async next(at: Position, now: number): Promise<Page | null> {
    switch (at.step) {
      case "organizations": {
        const page = await this.workos.organizations(at.after);
        return {
          events: page.data.map((data) => ({
            event: "organization.created",
            data,
          })),
          position: page.after
            ? { ...at, after: page.after }
            : { step: "connections", since: at.since },
        };
      }
      case "connections": {
        const page = await this.workos.connections(at.after);
        return {
          events: page.data.map((data) => ({
            event:
              data.state === "active"
                ? "connection.activated"
                : "connection.deactivated",
            data,
          })),
          position: page.after
            ? { ...at, after: page.after }
            : { step: "directories", since: at.since },
        };
      }
      case "directories": {
        const page = await this.workos.directories(at.after);
        return {
          events: page.data.map((data) => ({ event: "dsync.activated", data })),
          position: page.after
            ? { ...at, after: page.after }
            : { step: "contents", since: at.since },
        };
      }
      case "contents": {
        const directory = await this.directory(at.after);
        return await this.next(
          directory === null
            ? { step: "since", at: at.since }
            : { step: "users", since: at.since, directory },
          now,
        );
      }
      case "users": {
        const page = await this.workos.users(at.directory, at.after);
        return {
          events: page.data.map((data) => ({
            event: "dsync.user.created",
            data,
          })),
          position: page.after
            ? { ...at, after: page.after }
            : { step: "groups", since: at.since, directory: at.directory },
        };
      }
      case "groups": {
        const page = await this.workos.groups(at.directory, at.after);
        return {
          events: page.data.map((data) => ({
            event: "dsync.group.created",
            data,
          })),
          position: page.after
            ? { ...at, after: page.after }
            : { step: "contents", since: at.since, after: at.directory },
        };
      }
      case "since": {
        const end = Date.parse(at.at) + WINDOW_MS;
        const capped = end < now;
        const range_end = new Date(end).toISOString();
        const events = await this.workos.events(
          capped ? { range_start: at.at, range_end } : { range_start: at.at },
        );
        if (events.length > 0) return { events, position: after(events) };
        return capped
          ? { events, position: { step: "since", at: range_end } }
          : null;
      }
      case "after": {
        const events = await this.workos.events({ after: at.id });
        return events.length === 0 ? null : { events, position: after(events) };
      }
    }
  }
}

function after(events: WorkosEvent[]): Position {
  const id = events.at(-1)?.id;
  if (id === undefined) throw new Error("WorkOS sent an event with no id");
  return { step: "after", id };
}
