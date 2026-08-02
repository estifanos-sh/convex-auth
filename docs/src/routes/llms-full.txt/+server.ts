import { sidebar } from "$lib/config/sidebar";
import { documentationPage } from "$lib/server/markdown";

import type { RequestHandler } from "./$types";

// fallow-ignore-next-line unused-export
export const prerender = true;

export const GET: RequestHandler = () => {
  let output = `# convex-auth complete documentation

> Generated from the canonical Markdown source for @robelest/convex-auth.

`;

  for (const group of sidebar) {
    output += `## ${group.label}\n\n`;
    for (const item of group.items) {
      const page = documentationPage(item.slug);
      if (page) {
        output += `${page.markdown}\n\n`;
      }
    }
  }

  return new Response(output, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
