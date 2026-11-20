#!/usr/bin/env tsx
// A rerunnable probe of what the WorkOS component reads from WorkOS: the
// Events API and the list endpoints the fill uses. It answers whether WorkOS
// still sends what `packages/workos/src/component/validators.ts` decodes, in
// the order `pull` relies on.
//
// It prints event names, their order and the shape of each payload (field
// names and JSON types), never a value: the payloads carry directory data.
// The free-form maps (`raw_attributes`, `custom_attributes`, `metadata`) are
// printed without their keys, which the customer's directory names.
//
// It only reads. Point it at the environment to probe, Staging first:
//
//   WORKOS_API_KEY=sk_test_... pnpm tsx scripts/probeWorkosEvents.ts
//
// Checks:
//   - every event of the last 30 days that the copy applies, paged with
//     `after`: its name, whether ids and `created_at` ascend, whether it
//     decodes, and where it does not;
//   - that `after` with `range_start` is refused, as the fill assumes;
//   - the shape of the first page of each list endpoint the fill reads.

import {
  decode,
  DecodeError,
} from "../packages/workos/src/component/decode.ts";
import {
  EVENTS,
  vWorkosEvent,
} from "../packages/workos/src/component/validators.ts";

const API = "https://api.workos.com";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Bounds the probe, at 100 events a page. */
const MAX_PAGES = 50;
const FREE_FORM = new Set(["raw_attributes", "custom_attributes", "metadata"]);
const TAGS = new Set(["object", "event"]);

const key = process.env.WORKOS_API_KEY;
if (key === undefined || key === "") {
  console.error("Set WORKOS_API_KEY to the API key of the environment.");
  process.exit(1);
}

type Answer = { status: number; body: unknown };

async function get(
  path: string,
  query: [string, string][] = [],
): Promise<Answer> {
  const url = new URL(path, API);
  for (const [name, value] of query) url.searchParams.append(name, value);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    redirect: "error",
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: null };
  }
}

function fields(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

/** The field names and JSON types of `value`, and its tags, never a value. */
function shape(value: unknown, name = ""): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    const items = [...new Set(value.map((item) => shape(item)))];
    return items.length === 0 ? "[]" : `[${items.join(" | ")}]`;
  }
  if (typeof value === "object") {
    if (FREE_FORM.has(name)) return "{…}";
    const entries = Object.entries(value).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{ ${entries.map(([field, item]) => `${field}: ${shape(item, field)}`).join(", ")} }`;
  }
  if (typeof value === "string" && TAGS.has(name)) {
    return JSON.stringify(value);
  }
  return typeof value;
}

/** WorkOS's error code, which names a kind of refusal and no data. */
function code(body: unknown): string {
  const found = fields(body).code ?? fields(body).error;
  return typeof found === "string" && /^[a-z_]{1,64}$/.test(found)
    ? found
    : "(none)";
}

async function probeEvents(): Promise<void> {
  console.log("## /events, the last 30 days\n");
  const names = EVENTS.map((name): [string, string] => ["events", name]);
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
  let after: string | undefined;
  let lastId = "";
  let lastAt = "";
  let ascending = true;
  let count = 0;
  const shapes = new Map<string, Set<string>>();
  const refusals = new Map<string, Set<string>>();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const answer = await get("/events", [
      ...names,
      ["limit", "100"],
      ...(after === undefined
        ? ([["range_start", since]] as [string, string][])
        : ([["after", after]] as [string, string][])),
    ]);
    if (answer.status !== 200) {
      console.log(`page ${page}: HTTP ${answer.status}, ${code(answer.body)}`);
      return;
    }
    const data = fields(answer.body).data;
    if (!Array.isArray(data) || data.length === 0) break;
    const order: string[] = [];
    for (const raw of data) {
      const event = fields(raw);
      const name = typeof event.event === "string" ? event.event : "(none)";
      const id = typeof event.id === "string" ? event.id : "";
      const at = typeof event.created_at === "string" ? event.created_at : "";
      if (id <= lastId || at < lastAt) ascending = false;
      lastId = id;
      lastAt = at;
      count += 1;
      order.push(name);
      const seen = shapes.get(name) ?? new Set<string>();
      seen.add(shape(event.data));
      shapes.set(name, seen);
      try {
        decode(vWorkosEvent, raw);
      } catch (error) {
        if (!(error instanceof DecodeError)) throw error;
        const paths = refusals.get(name) ?? new Set<string>();
        paths.add(error.path);
        refusals.set(name, paths);
      }
    }
    console.log(`page ${page}: ${order.join(", ")}`);
    if (lastId === "") break;
    after = lastId;
  }
  console.log(`\n${count} events; ids and created_at ascend: ${ascending}`);
  console.log("\n### Shapes of `data`, by event\n");
  for (const [name, seen] of [...shapes].sort()) {
    for (const each of seen) console.log(`${name}: ${each}`);
  }
  console.log("\n### Events that do not decode, and where\n");
  if (refusals.size === 0) console.log("(none)");
  for (const [name, paths] of [...refusals].sort()) {
    console.log(`${name}: ${[...paths].join(", ")}`);
  }
}

async function probeAfterWithRange(): Promise<void> {
  console.log("\n## /events with both `after` and `range_start`\n");
  const answer = await get("/events", [
    ["events", EVENTS[0] ?? "dsync.user.created"],
    ["after", "event_01"],
    ["range_start", new Date(Date.now() - DAY_MS).toISOString()],
  ]);
  console.log(
    `HTTP ${answer.status}, ${code(answer.body)} (the fill assumes a refusal)`,
  );
}

async function probeLists(): Promise<void> {
  console.log("\n## The list endpoints the fill reads, first page\n");
  for (const path of ["/organizations", "/connections", "/directories"]) {
    const answer = await get(path, [["limit", "100"]]);
    console.log(`${path}: HTTP ${answer.status}`);
    console.log(`  ${shape(answer.body)}`);
  }
  const directories = fields(
    (await get("/directories", [["limit", "1"]])).body,
  ).data;
  const first = Array.isArray(directories) ? fields(directories[0]).id : null;
  if (typeof first !== "string") {
    console.log("(no directory, so no users or groups to list)");
    return;
  }
  for (const path of ["/directory_users", "/directory_groups"]) {
    const answer = await get(path, [
      ["directory", first],
      ["limit", "100"],
    ]);
    console.log(`${path}: HTTP ${answer.status}`);
    console.log(`  ${shape(answer.body)}`);
  }
}

await probeEvents();
await probeAfterWithRange();
await probeLists();
