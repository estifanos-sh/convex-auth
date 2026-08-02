import { documentationPage, documentationPages } from "$lib/server/markdown";

import type { EntryGenerator, RequestHandler } from "./$types";

// fallow-ignore-next-line unused-export
export const prerender = true;

export const entries: EntryGenerator = () =>
  documentationPages.map((page) => ({ document: page.slug.slice(1) }));

export const GET: RequestHandler = ({ params }) => {
  const page = documentationPage(`/${params.document}`);
  if (!page) {
    return new Response("Not found\n", { status: 404 });
  }

  return new Response(`${page.markdown}\n`, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
