#!/usr/bin/env node
/**
 * Regression guard: forbid the built-in `ctx.db.query(...).paginate()` inside
 * Convex component code.
 *
 * Inside a component the built-in paginate throws at runtime
 * (`paginate() is only supported in the app`). Component code must paginate
 * through convex-helpers instead:
 *
 *   paginator(ctx.db, schema).query("X")...paginate(opts)   // ok
 *   stream(ctx.db, schema).query("X").filterWith(...)       // ok
 *
 * This script scans `packages/auth/src/component/**` and exits non-zero if it
 * finds a `.paginate(` call whose receiver chain roots at the built-in
 * `ctx.db.query(...)` (directly, or via a `let q = ctx.db.query(...)` binding
 * that is later paginated). Calls rooted at `paginator(...)` / `stream(...)`
 * are allowed.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const componentDir = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : join(repoRoot, "packages", "auth", "src", "component");

/** Recursively collect `.ts` files under `dir`, skipping generated output. */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      if (entry === "_generated" || entry === "node_modules") {
        continue;
      }
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Replace the contents of string/template literals and comments with spaces of
 * equal length so byte offsets and line numbers are preserved while textual
 * matches inside strings/comments are neutralised.
 */
function stripStringsAndComments(src: string): string {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  const blank = (start: number, end: number): void => {
    for (let k = start; k < end; k++) {
      if (out[k] !== "\n") {
        out[k] = " ";
      }
    }
  };
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      let j = i + 2;
      while (j < n && src[j] !== "\n") j++;
      blank(i + 2, j);
      i = j;
    } else if (c === "/" && next === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      blank(i + 2, Math.min(j, n));
      i = Math.min(j + 2, n);
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === quote) break;
        j++;
      }
      blank(i + 1, Math.min(j, n));
      i = Math.min(j + 1, n);
    } else {
      i++;
    }
  }
  return out.join("");
}

const offsetToLine = (src: string, offset: number): number =>
  src.slice(0, offset).split("\n").length;

/**
 * Identifiers bound (via `=`) to a `ctx.db.query(...)` chain that does NOT pass
 * through `paginator(`/`stream(`. These are the variables that, when later
 * paginated, hit the forbidden built-in paginate.
 */
function collectDbQueryVars(code: string): Set<string> {
  const vars = new Set<string>();
  const assign =
    /(?:^|[;{}\n)])\s*(?:const|let|var\s+)?\s*([A-Za-z_$][\w$]*)\s*=\s*([^;]*?ctx\.db\s*\.\s*query\b[^;]*)/g;
  let m: RegExpExecArray | null;
  while ((m = assign.exec(code)) !== null) {
    const name = m[1];
    const rhs = m[2];
    if (/\b(?:paginator|stream)\s*\(/.test(rhs)) {
      continue;
    }
    vars.add(name);
  }
  return vars;
}

/**
 * Walk backwards from the `.` that precedes `.paginate(` to find the root token
 * of the receiver chain. Returns `{ root, chain }` where `root` is the leading
 * identifier/`)` and `chain` is the raw receiver text.
 */
function receiverChain(code: string, dotIndex: number): { root: string; chain: string } {
  let depth = 0;
  let i = dotIndex - 1;
  let rootStart = dotIndex;
  while (i >= 0) {
    const c = code[i];
    if (c === ")" || c === "]" || c === "}") {
      depth++;
    } else if (c === "(" || c === "[" || c === "{") {
      if (depth === 0) {
        break;
      }
      depth--;
    } else if (depth === 0 && /[;{}\n]/.test(c) && code[i] !== ".") {
      const before = code.slice(0, i + 1);
      if (!/[.=]\s*$/.test(before)) {
        break;
      }
    } else if (depth === 0 && !/[\w$.)\]\s]/.test(c)) {
      break;
    }
    rootStart = i;
    i--;
  }
  let chain = code.slice(rootStart, dotIndex).trim();
  // Strip leading statement context that is not part of the receiver chain:
  // `return await `, `const q = `, `let x =`, a bare `= `, `yield `, etc. The
  // receiver root is the first identifier (or parenthesised call) that remains.
  let prev;
  do {
    prev = chain;
    chain = chain.replace(/^(return|await|yield|new|const|let|var|typeof|void|delete)\b\s*/, "");
    chain = chain.replace(/^[A-Za-z_$][\w$]*\s*=(?!=)\s*/, "");
    chain = chain.replace(/^[([{,:?]\s*/, "");
    chain = chain.trim();
  } while (chain !== prev);
  const rootMatch = chain.match(/^[A-Za-z_$][\w$]*/);
  return { root: rootMatch ? rootMatch[0] : "", chain };
}

const violations: Array<{ file: string; line: number; root: string }> = [];
const files = collectTsFiles(componentDir).sort();

for (const file of files) {
  const raw = readFileSync(file, "utf8");
  const code = stripStringsAndComments(raw);
  const dbVars = collectDbQueryVars(code);

  const paginate = /\.\s*paginate\s*\(/g;
  let pm: RegExpExecArray | null;
  while ((pm = paginate.exec(code)) !== null) {
    const dotIndex = pm.index;
    const { root, chain } = receiverChain(code, dotIndex);
    const rootsAtHelper = /\b(?:paginator|stream)\s*\(/.test(chain);
    if (rootsAtHelper) {
      continue;
    }
    const inlineDbQuery = /ctx\.db\s*\.\s*query\b/.test(chain);
    const viaDbVar = dbVars.has(root);
    if (inlineDbQuery || viaDbVar) {
      violations.push({
        file: relative(repoRoot, file),
        line: offsetToLine(code, dotIndex),
        root,
      });
    }
  }
}

if (violations.length > 0) {
  console.error(
    "Forbidden built-in paginate() in component code.\n" +
      "Inside a Convex component, ctx.db.query(...).paginate() throws at runtime\n" +
      "(`paginate() is only supported in the app`). Use convex-helpers instead:\n" +
      '  paginator(ctx.db, schema).query("X")...paginate(opts)\n' +
      '  stream(ctx.db, schema).query("X").filterWith(...)\n',
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  (paginate on \`${v.root}\`)`);
  }
  console.error(`\n${violations.length} violation(s) found.`);
  process.exit(1);
}

console.log(
  `check:component-paginate ok — scanned ${files.length} file(s), no built-in paginate() in component code.`,
);
