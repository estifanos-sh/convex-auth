import { HeadContent, Scripts, createRootRoute } from "@tanstack/solid-router";
import type { JSX } from "solid-js";
import { HydrationScript } from "solid-js/web";
import "../app.css";

export const Route = createRootRoute({
  head: () => ({
    links: [
      { href: "/convex-auth/favicon.svg", rel: "icon", type: "image/svg+xml" },
      {
        as: "font",
        crossorigin: "anonymous",
        href: "/convex-auth/fonts/figtree.woff2",
        rel: "preload",
        type: "font/woff2",
      },
    ],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { content: "Authentication infrastructure for Convex applications.", name: "description" },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument(props: { children: JSX.Element }) {
  return (
    <html lang="en">
      <head>
        <HydrationScript />
        <HeadContent />
      </head>
      <body>
        {props.children}
        <Scripts />
      </body>
    </html>
  );
}
