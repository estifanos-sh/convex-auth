import { createFileRoute } from "@tanstack/solid-router";
import { HomePage } from "../components/home";

export const Route = createFileRoute("/")({
  head: () => ({
    links: [{ href: "/convex-auth/", rel: "canonical" }],
    meta: [
      { title: "Convex Auth by Estifanos" },
      {
        content: "The unofficial auth solution for Convex.",
        name: "description",
      },
    ],
  }),
  component: HomePage,
});
