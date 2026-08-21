import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const build = path.join(root, "docs", "dist", "client", "convex-auth");
const fonts = ["inter.woff2", "intertight.woff2"];
const required = [
  "index.html",
  "404.html",
  "llms.txt",
  "llms-full.txt",
  "ai/agent-skills.md",
  "getting-started/installation.md",
  "pagefind/pagefind.js",
];

function collectHtml(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? collectHtml(file) : entry.name.endsWith(".html") ? [file] : [];
  });
}

for (const relative of required) {
  const file = path.join(build, relative);
  if (!statSync(file).isFile() || statSync(file).size === 0)
    throw new Error(`Missing static docs artifact: ${relative}`);
}

const pages = collectHtml(build);
for (const page of pages) {
  if (path.basename(page) === "404.html") continue;
  const html = readFileSync(page, "utf8");
  if (!html.includes('rel="icon"') || !html.includes("/convex-auth/favicon.svg"))
    throw new Error(`Missing canonical favicon: ${page}`);
  if (!html.includes("data-pagefind-body") && path.basename(page) !== "index.html")
    throw new Error(`Missing Pagefind body: ${page}`);
  for (const font of fonts) {
    if (!html.includes(`/convex-auth/fonts/${font}`))
      throw new Error(`Missing ${font} preload: ${page}`);
  }
}

for (const font of fonts) {
  if (!statSync(path.join(build, "fonts", font)).size) throw new Error(`Empty font: ${font}`);
}

const llms = readFileSync(path.join(build, "llms.txt"), "utf8");
if (!llms.includes("@estifanos-sh/convex-auth") || !llms.includes("/ai/agent-skills.md"))
  throw new Error("llms.txt is incomplete");
const environment = readFileSync(
  path.join(build, "getting-started", "environment", "index.html"),
  "utf8",
);
if (!environment.includes("<table>") || environment.includes("| Variable | Purpose |"))
  throw new Error("Environment variable tables were not compiled as GFM tables");
if (!readFileSync(path.join(build, "404.html"), "utf8").includes('name="robots" content="noindex"'))
  throw new Error("404.html must be noindex");

console.log(
  `Verified ${pages.length} static HTML pages, Pagefind, Markdown aliases, local fonts, and canonical convex-auth paths.`,
);
