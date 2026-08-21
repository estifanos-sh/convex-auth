import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const publicDir = path.join(root, "dist", "client");
const target = path.join(root, "dist", "client", "convex-auth");
const staging = path.join(root, ".docs-static");
const source = existsSync(path.join(publicDir, "convex-auth"))
  ? path.join(publicDir, "convex-auth")
  : publicDir;

interface DocumentationPage {
  description: string;
  markdown: string;
  slug: string;
  title: string;
}

if (!existsSync(source)) throw new Error(`TanStack static output is missing: ${source}`);
rmSync(staging, { force: true, recursive: true });
cpSync(source, staging, { recursive: true });
rmSync(path.join(root, "dist"), { force: true, recursive: true });
mkdirSync(path.dirname(target), { recursive: true });
cpSync(staging, target, { recursive: true });
rmSync(staging, { force: true, recursive: true });

const documentationPages = JSON.parse(
  readFileSync(path.join(root, "src", "generated", "docs.json"), "utf8"),
) as DocumentationPage[];
for (const page of documentationPages) {
  const pathname = page.slug.slice(1);
  const file = path.join(target, `${pathname}.md`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${page.markdown}\n`);
}

const index = documentationPages
  .map((page) => `- [${page.title}](/convex-auth${page.slug}.md): ${page.description}`)
  .join("\n");
writeFileSync(
  path.join(target, "llms.txt"),
  `# convex-auth documentation\n\n> Authentication and authorization for Convex applications using @estifanos-sh/convex-auth.\n\n${index}\n`,
);
writeFileSync(
  path.join(target, "llms-full.txt"),
  `# convex-auth complete documentation\n\n${documentationPages.map((page) => `## ${page.title}\n\n${page.markdown}`).join("\n\n")}\n`,
);
writeFileSync(
  path.join(target, "404.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="/convex-auth/favicon.svg" type="image/svg+xml"><title>404 | Convex Auth</title><style>:root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{min-height:100svh;margin:0;display:grid;place-items:center;background:#f6f6f6;color:#4f4f52}main{padding:2rem;text-align:center}h1{margin:0;color:#141414;font-size:3rem;font-weight:700;letter-spacing:-.05em}a{color:#8d2676}</style></head><body><main><h1>404</h1><p>This page does not exist.</p><a href="/convex-auth/">Return to Convex Auth.</a></main></body></html>\n`,
);
