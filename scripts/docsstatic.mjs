import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const build = path.join(root, "docs", "build");
const fonts = ["figtree.woff2", "martianmono.woff2"];
const faviconSvg = path.join(build, "favicon.svg");
const faviconIco = path.join(build, "favicon.ico");
const expectedFaviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect x="6" y="6" width="20" height="20" fill="#7da39b" />
  <rect
    x="6.5"
    y="6.5"
    width="19"
    height="19"
    fill="none"
    stroke="#12130f"
    stroke-opacity="0.35"
  />
</svg>`;
const expectedFaviconIcoSha256 = "d01e2d610b71e7b584c1b6e9602bd7d4416c14cec415d9d79f8e3fe19f593125";
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

if (readFileSync(faviconSvg, "utf8").trim() !== expectedFaviconSvg) {
  throw new Error("favicon.svg does not match the canonical Robelest accent square");
}

const faviconIcoSha256 = createHash("sha256").update(readFileSync(faviconIco)).digest("hex");
if (faviconIcoSha256 !== expectedFaviconIcoSha256) {
  throw new Error("favicon.ico does not match the canonical accent-square fallback");
}

for (const page of pages) {
  const html = readFileSync(page, "utf8");
  const icon = [...html.matchAll(/<link\b[^>]*>/g)]
    .map(([tag]) => tag)
    .find((tag) => tag.includes('rel="icon"') && tag.includes('type="image/svg+xml"'));
  const iconHref = icon?.match(/\bhref="([^"]+)"/)?.[1];

  if (!iconHref) {
    throw new Error(`Missing SVG favicon in ${path.relative(build, page)}`);
  }

  const assetHref = iconHref.split(/[?#]/, 1)[0];
  const resolved = assetHref.startsWith("/")
    ? path.join(build, assetHref)
    : path.resolve(path.dirname(page), assetHref);

  if (resolved !== faviconSvg) {
    throw new Error(
      `${path.relative(build, page)} resolves ${iconHref} outside the canonical favicon path`,
    );
  }
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
  `Verified the square favicon and ${fonts.length} preloaded local fonts across ${pages.length} pages and ${machineReadableDocs.length} machine-readable documentation files.`,
);
