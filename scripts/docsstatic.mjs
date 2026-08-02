import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const build = path.join(root, "docs", "build");
const fonts = ["figtree.woff2", "martianmono.woff2"];
const styles = readdirSync(path.join(build, "_app", "immutable", "assets"))
  .filter((file) => file.endsWith(".css"))
  .map((file) => readFileSync(path.join(build, "_app", "immutable", "assets", file), "utf8"))
  .join("\n");

function collectHtml(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectHtml(file);
    return entry.name.endsWith(".html") ? [file] : [];
  });
}

const pages = collectHtml(build);
const machineReadableDocs = [
  "llms.txt",
  "llms-full.txt",
  "ai/agent-skills.md",
  "getting-started/installation.md",
];

for (const relative of machineReadableDocs) {
  const file = path.join(build, relative);
  if (!statSync(file).isFile() || statSync(file).size === 0) {
    throw new Error(`Missing machine-readable documentation: ${relative}`);
  }
}

const llmsIndex = readFileSync(path.join(build, "llms.txt"), "utf8");
if (!llmsIndex.includes("/ai/agent-skills.md") || !llmsIndex.includes("/llms-full.txt")) {
  throw new Error("llms.txt does not link the Agent Skills page and full corpus");
}

for (const font of fonts) {
  const href = `fonts/${font}`;
  const file = path.join(build, "fonts", font);

  if (statSync(file).size <= 0) {
    throw new Error(`Bundled font is empty: ${file}`);
  }

  if (!styles.includes(href)) {
    throw new Error(`Built CSS does not reference ${href}`);
  }

  for (const page of pages) {
    const html = readFileSync(page, "utf8");
    const preload = [...html.matchAll(/<link\b[^>]*>/g)]
      .map(([tag]) => tag)
      .find((tag) => tag.includes('rel="preload"') && tag.includes(`/${href}`));
    const preloadHref = preload?.match(/\bhref="([^"]+)"/)?.[1];

    if (!preloadHref) {
      throw new Error(`Missing ${font} preload in ${path.relative(build, page)}`);
    }

    const resolved = preloadHref.startsWith("/")
      ? path.join(build, preloadHref)
      : path.resolve(path.dirname(page), preloadHref);

    if (resolved !== file) {
      throw new Error(
        `${path.relative(build, page)} resolves ${preloadHref} outside the bundled font path`,
      );
    }
  }
}

console.log(
  `Verified ${fonts.length} preloaded local fonts across ${pages.length} pages and ${machineReadableDocs.length} machine-readable documentation files.`,
);
