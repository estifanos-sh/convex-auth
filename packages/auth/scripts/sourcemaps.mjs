import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceMapPattern = /[#@]\s*sourceMappingURL=([^\s*]+)/g;
const cache = mkdtempSync(path.join(tmpdir(), "convex-auth-npm-cache-"));
let pack;
try {
  pack = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: packageRoot,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: cache },
    }),
  );
} finally {
  rmSync(cache, { force: true, recursive: true });
}
const published = new Set(pack[0]?.files?.map((file) => file.path) ?? []);
const missing = [];

for (const file of published) {
  if (!file.endsWith(".js") && !file.endsWith(".d.ts")) {
    continue;
  }
  const contents = await readFile(path.join(packageRoot, file), "utf8");
  for (const match of contents.matchAll(sourceMapPattern)) {
    const reference = match[1];
    if (!reference || reference.startsWith("data:")) {
      continue;
    }
    const target = path
      .relative(
        packageRoot,
        path.resolve(packageRoot, path.dirname(file), decodeURIComponent(reference)),
      )
      .split(path.sep)
      .join("/");
    if (!published.has(target)) {
      missing.push(`${file} -> ${reference}`);
    }
  }
}

if (missing.length > 0) {
  throw new Error(`Published files reference missing source maps:\n${missing.join("\n")}`);
}
