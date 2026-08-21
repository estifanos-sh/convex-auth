import { HeadContent, Scripts, createRootRoute } from "@tanstack/solid-router";
import type { JSX } from "solid-js";
import { HydrationScript } from "solid-js/web";
import "../app.css";

const themeBootstrap = `(()=>{try{const t=localStorage.getItem("convex-auth-theme");if(t==="dark")document.documentElement.classList.add("dark")}catch{}})();`;

export const Route = createRootRoute({
  head: () => ({
    links: [
      { href: "/convex-auth/favicon.svg", rel: "icon", type: "image/svg+xml" },
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
        <script innerHTML={themeBootstrap} />
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
