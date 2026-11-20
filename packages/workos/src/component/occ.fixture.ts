/**
 * The read and write sets of a function run under convex-test, from the
 * syscalls it makes, and the conflicts Convex's optimistic concurrency would
 * find between two runs. convex-test runs one function at a time and never
 * conflicts, so the tests that concurrent runs never conflict check their
 * footprints instead: a run conflicts with another that committed while it
 * ran when a document the other wrote, before or after the write, is in a
 * range the run read.
 *
 * @module
 */

type Value = unknown;
type Doc = Record<string, Value>;
type Filter = {
  type: "Eq" | "Gt" | "Gte" | "Lt" | "Lte";
  fieldPath: string;
  value: Value;
};
type Read =
  | { kind: "range"; table: string; filters: Filter[] }
  | { kind: "point"; table: string; id: string };
type Write = { table: string; id: string; states: Doc[] };

export type Footprint = { reads: Read[]; writes: Write[] };

type AsyncSyscall = (op: string, args: string) => Promise<string>;
type Syscall = (op: string, args: string) => string;

function fields(value: unknown): Doc {
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function convexGlobal(): object {
  const global: unknown = Reflect.get(globalThis, "Convex");
  if (typeof global !== "object" || global === null) {
    throw new Error("Call convexTest() before recording a footprint");
  }
  return global;
}

/** Run `run`, and return its result with the reads and writes it made. */
export async function footprint<Result>(
  run: () => Promise<Result>,
): Promise<{ result: Result } & Footprint> {
  const global = convexGlobal();
  const reads: Read[] = [];
  const writes: Write[] = [];
  const syscall = Object.getOwnPropertyDescriptor(global, "syscall");
  const asyncSyscall = Object.getOwnPropertyDescriptor(global, "asyncSyscall");
  Object.defineProperty(global, "syscall", {
    configurable: true,
    get: () => {
      const inner = syscall?.get?.call(global) as Syscall;
      return (op: string, args: string): string => {
        if (op === "1.0/queryStream") {
          const source = fields(fields(JSON.parse(args)).query).source;
          const { type, indexName, tableName, range } = fields(source);
          reads.push(
            type === "IndexRange"
              ? {
                  kind: "range",
                  table: text(indexName).split(".")[0] ?? "",
                  filters: Array.isArray(range) ? (range as Filter[]) : [],
                }
              : { kind: "range", table: text(tableName), filters: [] },
          );
        }
        return inner(op, args);
      };
    },
  });
  Object.defineProperty(global, "asyncSyscall", {
    configurable: true,
    get: () => {
      const inner = asyncSyscall?.get?.call(global) as AsyncSyscall;
      const get = async (table: string, id: string) =>
        fields(
          JSON.parse(await inner("1.0/get", JSON.stringify({ table, id }))),
        );
      return async (op: string, args: string): Promise<string> => {
        const parsed = fields(JSON.parse(args));
        const table = text(parsed.table);
        const id = text(parsed.id);
        switch (op) {
          case "1.0/get":
            reads.push({ kind: "point", table, id });
            return await inner(op, args);
          case "1.0/insert": {
            const answer = await inner(op, args);
            const inserted = text(fields(JSON.parse(answer))._id);
            writes.push({
              table,
              id: inserted,
              states: [await get(table, inserted)],
            });
            return answer;
          }
          case "1.0/replace":
          case "1.0/shallowMerge":
          case "1.0/remove": {
            reads.push({ kind: "point", table, id });
            const before = await get(table, id);
            const answer = await inner(op, args);
            const after = await get(table, id);
            writes.push({
              table,
              id,
              states: [before, after].filter(
                (doc) => Object.keys(doc).length > 0,
              ),
            });
            return answer;
          }
          default:
            return await inner(op, args);
        }
      };
    },
  });
  try {
    return { result: await run(), reads, writes };
  } finally {
    if (syscall !== undefined)
      Object.defineProperty(global, "syscall", syscall);
    if (asyncSyscall !== undefined) {
      Object.defineProperty(global, "asyncSyscall", asyncSyscall);
    }
  }
}

/** Convex's order of values, for the types the component's indexes hold. */
function rank(value: Value): number {
  if (value === undefined) return 0;
  if (value === null) return 1;
  if (typeof value === "number") return 2;
  if (typeof value === "boolean") return 3;
  if (typeof value === "string") return 4;
  return 5;
}

function compare(a: Value, b: Value): number {
  const order = rank(a) - rank(b);
  if (order !== 0) return order;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    return Number(a) - Number(b);
  }
  return 0;
}

function within(doc: Doc, filter: Filter): boolean {
  let value: Value = doc;
  for (const name of filter.fieldPath.split(".")) value = fields(value)[name];
  const order = compare(value, filter.value);
  switch (filter.type) {
    case "Eq":
      return order === 0;
    case "Gt":
      return order > 0;
    case "Gte":
      return order >= 0;
    case "Lt":
      return order < 0;
    case "Lte":
      return order <= 0;
  }
}

/**
 * The writes of `writer` that fall in the read set of `reader`: each would
 * make `reader` retry, had `writer` committed while it ran.
 */
export function conflicts(reader: Footprint, writer: Footprint): number {
  return writer.writes.filter((write) =>
    reader.reads.some(
      (read) =>
        read.table === write.table &&
        (read.kind === "point"
          ? read.id === write.id
          : write.states.some((doc) =>
              read.filters.every((filter) => within(doc, filter)),
            )),
    ),
  ).length;
}
