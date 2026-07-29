import adapter from "@sveltejs/adapter-static";
import { mdsvex } from "mdsvex";
import { createHighlighter } from "shiki";

const docsBase = "/docs";

function prefixInternalLinks() {
  return (tree) => {
    const visit = (node) => {
      if (
        node.type === "link" &&
        typeof node.url === "string" &&
        node.url.startsWith("/") &&
        !node.url.startsWith("//") &&
        node.url !== docsBase &&
        !node.url.startsWith(`${docsBase}/`)
      ) {
        node.url = `${docsBase}${node.url}`;
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          visit(child);
        }
      }
    };
    visit(tree);
  };
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

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({ fallback: "404.html" }),
    paths: { base: docsBase },
  },
  vitePlugin: {
    dynamicCompileOptions: ({ filename }) =>
      filename.includes("node_modules") ? undefined : { runes: true },
    onwarn(warning, handler) {
      if (warning.code === "script_context_deprecated") return;
      if (warning.code === "css_unused_selector" && warning.message?.includes("data-theme")) return;
      handler(warning);
    },
  },
  preprocess: [
    mdsvex({
      extensions: [".md"],
      remarkPlugins: [prefixInternalLinks],
      highlight: {
        highlighter: (code, lang) => {
          const html = highlighter.codeToHtml(code, {
            lang: lang || "text",
            themes: { light: "github-light", dark: "github-dark-dimmed" },
          });
          return `{@html \`${html.replace(/`/g, "\\`").replace(/\$/g, "\\$")}\`}`;
        },
      },
    }),
  ],
  extensions: [".svelte", ".md"],
};

export default config;
