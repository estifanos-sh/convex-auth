import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import rehypeStringify from "rehype-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { createHighlighter } from "shiki";
import { unified } from "unified";
import { visit } from "unist-util-visit";

const root = path.resolve(import.meta.dirname, "../..");
const source = path.join(root, "src", "content");
const generated = path.join(root, "src", "generated", "docs.ts");
const generatedJson = path.join(root, "src", "generated", "docs.json");
const generatedPages = path.join(root, "src", "generated", "pages");

interface DocumentationPage {
  description: string;
  html: string;
  markdown: string;
  slug: string;
  title: string;
}

interface MutableNode {
  attributes?: Array<{ name: string; type: string; value?: unknown }>;
  children?: MutableNode[];
  depth?: number;
  lang?: string;
  meta?: string;
  name?: string;
  properties?: Record<string, unknown>;
  tagName?: string;
  type: string;
  value?: string;
}
const highlighter = await createHighlighter({
  themes: ["github-dark-dimmed", "github-light"],
  langs: [
    "typescript",
    "javascript",
    "bash",
    "json",
    "http",
    "html",
    "css",
    "svelte",
    "tsx",
    "jsx",
    "yaml",
    "toml",
    "diff",
    "text",
  ],
});

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

function textContent(node: MutableNode): string {
  if (node.type === "text") return node.value ?? "";
  return node.children?.map(textContent).join("") ?? "";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function removeSveltePrelude(source: string): string {
  return source
    .replace(/^\s*<script[\s\S]*?<\/script>\s*/u, "")
    .replace(/^\s*<svelte:head>[\s\S]*?<\/svelte:head>\s*/u, "");
}

function componentAttributes(attributes: MutableNode["attributes"] = []): Record<string, unknown> {
  return Object.fromEntries(
    attributes
      .filter((attribute) => attribute.type === "mdxJsxAttribute")
      .map((attribute) => [attribute.name, attribute.value ?? ""]),
  );
}

function markdownComponents() {
  return (tree: MutableNode): void => {
    visit(tree, (node: MutableNode) => {
      if (node.type === "code") {
        node.type = "html";
        node.value = highlighter.codeToHtml(node.value ?? "", {
          lang: node.lang || "text",
          themes: { light: "github-light", dark: "github-dark-dimmed" },
        });
        delete node.lang;
        delete node.meta;
        return;
      }

      if (node.type !== "mdxJsxFlowElement" && node.type !== "mdxJsxTextElement") return;
      const attributes = componentAttributes(node.attributes);

      if (node.name === "script" || node.name === "svelte:head") {
        node.type = "element";
        node.tagName = "template";
        node.properties = {};
        node.children = [];
        return;
      }

      const definitions = {
        CardGrid: { tagName: "div", properties: { className: ["card-grid"] } },
        Tabs: { tagName: "div", properties: { className: ["tabs"], dataTabs: "" } },
        TabItem: {
          tagName: "section",
          properties: { className: ["tab-panel"], dataTab: attributes.label || "Tab" },
        },
      };
      const definition = node.name
        ? (definitions as Record<string, { properties: Record<string, unknown>; tagName: string }>)[
            node.name
          ]
        : undefined;

      if (node.name === "Card") {
        node.type = "element";
        node.tagName = "article";
        node.properties = { className: ["card"] };
        node.children = [
          {
            type: "element",
            tagName: "p",
            properties: { className: ["card-title"] },
            children: [
              {
                type: "text",
                value: typeof attributes.title === "string" ? attributes.title : "",
              },
            ],
          },
          {
            type: "element",
            tagName: "div",
            properties: { className: ["card-body"] },
            children: node.children ?? [],
          },
        ];
        return;
      }

      if (definition) {
        node.type = "element";
        node.tagName = definition.tagName;
        node.properties = definition.properties;
        return;
      }

      node.type = "element";
      node.tagName = node.name || "span";
      node.properties = attributes;
    });
  };
}

function removeDocumentTitle() {
  return (tree: MutableNode): void => {
    const titleIndex = (tree.children ?? []).findIndex(
      (node: MutableNode) => node.type === "heading" && node.depth === 1,
    );
    if (titleIndex !== -1) tree.children?.splice(titleIndex, 1);
  };
}

function addHeadingIds() {
  const seen = new Map<string, number>();
  return (tree: MutableNode): void => {
    visit(tree, "element", (node: MutableNode) => {
      if (!node.tagName || !/^h[1-6]$/.test(node.tagName)) return;
      const base = slugify(textContent(node)) || "section";
      const suffix = seen.get(base) || 0;
      seen.set(base, suffix + 1);
      node.properties ??= {};
      node.properties.id = suffix ? `${base}-${suffix + 1}` : base;
    });
  };
}

function prefixInternalLinks() {
  return (tree: MutableNode): void => {
    visit(tree, "element", (node: MutableNode) => {
      if (node.tagName !== "a" || typeof node.properties?.href !== "string") return;
      const href = node.properties.href;
      if (href.startsWith("/") && !href.startsWith("/convex-auth/")) {
        const [pathAndQuery, hash] = href.split("#", 2);
        const [pathname, query] = pathAndQuery.split("?", 2);
        const routePath =
          !path.extname(pathname) && !pathname.endsWith("/") ? `${pathname}/` : pathname;
        node.properties.href = `/convex-auth${routePath}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
      }
    });
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm)
  .use(remarkMdx)
  .use(removeDocumentTitle)
  .use(markdownComponents)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(addHeadingIds)
  .use(prefixInternalLinks)
  .use(rehypeStringify, { allowDangerousHtml: true });

const pages: DocumentationPage[] = await Promise.all(
  walk(source)
    .filter((file) => file.endsWith("+page.md"))
    .sort()
    .map(async (file) => {
      const parsed = matter(readFileSync(file, "utf8"));
      const relative = path.relative(source, file).replace(/\/\\/g, "/");
      const slug = `/${relative.slice(0, -"/+page.md".length)}`;
      const title = String(parsed.data.title || slug.split("/").at(-1) || "convex-auth");
      const description = String(parsed.data.description || "");
      const content = removeSveltePrelude(parsed.content);
      const html = String(await processor.process(content));
      return { description, html, markdown: content.trim(), slug, title };
    }),
);

mkdirSync(path.dirname(generated), { recursive: true });
rmSync(generatedPages, { force: true, recursive: true });
mkdirSync(generatedPages, { recursive: true });

const pageEntries = pages.map((page, index) => {
  const filename = `${String(index).padStart(2, "0")}-${page.slug.slice(1).replaceAll("/", "-")}`;
  const { markdown: _markdown, ...clientPage } = page;
  writeFileSync(
    path.join(generatedPages, `${filename}.ts`),
    `import type { DocumentationPage } from "../docs";\n\n` +
      `const page = ${JSON.stringify(clientPage)} satisfies DocumentationPage;\n\n` +
      `export default page;\n`,
  );
  return { filename, page };
});

writeFileSync(
  generated,
  `/* This file is generated by scripts/content/compile.ts. */\n` +
    `export interface DocumentationPage { title: string; description: string; slug: string; html: string; }\n` +
    `export interface DocumentationPageMeta { title: string; description: string; slug: string; }\n` +
    `export const documentationPages: DocumentationPageMeta[] = ${JSON.stringify(pages.map(({ html: _html, markdown: _markdown, ...page }) => page))};\n` +
    `export const documentationBySlug = new Map(documentationPages.map((page) => [page.slug, page]));\n` +
    `export const documentationLoaders: Record<string, () => Promise<DocumentationPage>> = {\n${pageEntries
      .map(
        ({ filename, page }) =>
          `  ${JSON.stringify(page.slug)}: () => import("./pages/${filename}").then((module) => module.default),`,
      )
      .join("\n")}\n};\n`,
);
writeFileSync(generatedJson, `${JSON.stringify(pages, null, 2)}\n`);
