import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "convex-auth documentation" }] }),
  component: Landing,
});

function Landing() {
  return (
    <main class="landing" id="main-content">
      <a class="skip-link" href="#landing-content">
        Skip to documentation
      </a>
      <section class="landing-copy" id="landing-content">
        <p class="eyebrow">estifanos.sh / convex-auth</p>
        <h1>convex-auth</h1>
        <p>Authentication and authorization for Convex applications.</p>
        <pre class="install">
          <code>pnpm add @estifanos-sh/convex-auth</code>
        </pre>
        <a class="entry-link" href="/convex-auth/getting-started/installation/">
          Get started <span aria-hidden="true">→</span>
        </a>
      </section>
    </main>
  );
}
