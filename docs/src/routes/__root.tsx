import { HeadContent, Scripts, createRootRoute } from "@tanstack/solid-router";
import type { JSX } from "solid-js";
import { HydrationScript } from "solid-js/web";
import "../app.css";

export const Route = createRootRoute({
  head: () => ({
    links: [
      { href: "/convex-auth/favicon.svg", rel: "icon", type: "image/svg+xml" },
      { href: "https://use.typekit.net", rel: "preconnect" },
      { href: "https://p.typekit.net", rel: "preconnect" },
      { href: "https://fonts.googleapis.com", rel: "preconnect" },
      { crossorigin: "anonymous", href: "https://fonts.gstatic.com", rel: "preconnect" },
      { href: "https://use.typekit.net/xmd6bow.css", rel: "stylesheet" },
      {
        href: "https://fonts.googleapis.com/css2?family=Geist:wght@300..800&family=Geist+Mono:wght@400..700&display=swap",
        rel: "stylesheet",
      },
      {
        as: "font",
        crossorigin: "anonymous",
        href: "/convex-auth/fonts/inter.woff2",
        rel: "preload",
        type: "font/woff2",
      },
      {
        as: "font",
        crossorigin: "anonymous",
        href: "/convex-auth/fonts/intertight.woff2",
        rel: "preload",
        type: "font/woff2",
      },
    ],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { content: "The unofficial auth solution for Convex.", name: "description" },
      { content: "#f7eedb", name: "theme-color" },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument(props: { children: JSX.Element }) {
  return (
    <html data-theme="convex" lang="en">
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
