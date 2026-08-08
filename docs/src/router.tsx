import { createRouter } from "@tanstack/solid-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({ basepath: "/convex-auth", routeTree, scrollRestoration: true });
}
