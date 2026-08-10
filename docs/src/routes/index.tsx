import { createFileRoute, redirect } from "@tanstack/solid-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ href: "/convex-auth/getting-started/installation/" });
  },
});
