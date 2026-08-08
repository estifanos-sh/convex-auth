import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  base: "/convex-auth/",
  plugins: [
    tanstackStart({
      prerender: {
        autoStaticPathsDiscovery: true,
        autoSubfolderIndex: true,
        crawlLinks: true,
        enabled: true,
        failOnError: true,
        filter: ({ path }) =>
          (path === "/" || path.startsWith("/convex-auth")) &&
          !path.includes("#") &&
          !/\.(?:md|txt)$/u.test(path.split("?", 1)[0]),
      },
    }),
    solid({ ssr: true }),
  ],
});
