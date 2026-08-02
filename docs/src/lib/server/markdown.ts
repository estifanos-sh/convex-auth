const files = import.meta.glob("/src/routes/**/+page.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export interface DocumentationPage {
  title: string;
  description: string;
  slug: string;
  markdown: string;
}

function frontmatterValue(raw: string, key: string): string {
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---\n?/u)?.[1] ?? "";
  const lines = frontmatter.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start < 0) return "";

  const parts = [lines[start].slice(key.length + 1).trim()];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+/u.test(line)) break;
    parts.push(line.trim());
  }

  const value = parts.join(" ").replace(/^[>|]\s*/u, "");
  return value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u, "$1$2");
}

export function cleanMarkdown(raw: string): string {
  return raw
    .replace(/^---[\s\S]*?---\n*/u, "")
    .replace(/<script[\s\S]*?<\/script>/gu, "")
    .replace(/<svelte:head[\s\S]*?<\/svelte:head>/gu, "")
    .replace(/<TabItem\s+label="([^"]+)"[^>]*>/gu, "\n### $1\n")
    .replace(/<Card\s+title="([^"]+)"[^>]*>/gu, "\n### $1\n")
    .replace(/<\/?(?:Tabs|TabItem|Card|CardGrid)[^>]*>/gu, "")
    .replace(/\n[\t ]+\n/gu, "\n\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export const documentationPages: DocumentationPage[] = Object.entries(files)
  .map(([path, raw]) => {
    const slug = path.slice("/src/routes".length, -"/+page.md".length);
    return {
      title: frontmatterValue(raw, "title") || slug.split("/").at(-1) || "convex-auth",
      description: frontmatterValue(raw, "description"),
      slug,
      markdown: cleanMarkdown(raw),
    };
  })
  .sort((a, b) => a.slug.localeCompare(b.slug));

export function documentationPage(slug: string): DocumentationPage | undefined {
  return documentationPages.find((page) => page.slug === slug);
}
