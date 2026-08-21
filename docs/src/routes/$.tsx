import { createFileRoute, notFound } from "@tanstack/solid-router";
import { documentationBySlug, documentationLoaderBySlug } from "../generated/docs";
import { DocsShell } from "../components/shell";

export const Route = createFileRoute("/$")({
  beforeLoad: ({ params }) => {
    const slug = pageSlug(params._splat);
    if (!documentationBySlug.has(slug)) throw notFound();
  },
  loader: async ({ params }) => {
    const load = documentationLoaderBySlug.get(pageSlug(params._splat));
    if (!load) throw notFound();
    return load();
  },
  head: ({ loaderData }) => ({
    links: loaderData ? [{ href: `/convex-auth${loaderData.slug}/`, rel: "canonical" }] : [],
    meta: loaderData
      ? [
          { title: `${loaderData.title} | Convex Auth` },
          { content: loaderData.description, name: "description" },
        ]
      : [],
  }),
  component: DocumentPage,
  notFoundComponent: NotFound,
});

function pageSlug(splat: string | undefined) {
  return `/${(splat || "").replace(/\/$/, "")}`;
}

function DocumentPage() {
  const page = Route.useLoaderData();
  return <DocsShell page={page()} />;
}

function NotFound() {
  return (
    <main class="not-found">
      <meta name="robots" content="noindex" />
      <h1>404</h1>
      <p>This page does not exist.</p>
      <a href="/convex-auth/">Return to Convex Auth.</a>
    </main>
  );
}
