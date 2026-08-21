import { For, createSignal } from "solid-js";
import { Chrome } from "./chrome";
import { CopyIcon } from "./icons";

const installCommand = "pnpm add @estifanos-sh/convex-auth";

const paths = [
  {
    href: "/convex-auth/getting-started/installation/",
    title: "Installation",
    body: "Add the component, wire providers, and run the CLI.",
  },
  {
    href: "/convex-auth/getting-started/providers/",
    title: "Providers",
    body: "Password, OAuth, magic links, passkeys, and anonymous auth.",
  },
  {
    href: "/convex-auth/connection/overview/",
    title: "Enterprise SSO",
    body: "OIDC, SAML, SCIM, and connection policies for groups.",
  },
  {
    href: "/convex-auth/ssr/overview/",
    title: "Server rendering",
    body: "Cookie refresh for Next.js, SvelteKit, and TanStack Start.",
  },
];

export function HomePage() {
  const [copied, setCopied] = createSignal(false);
  const copy = async () => {
    await navigator.clipboard.writeText(installCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Chrome landing>
      <main class="home" id="main-content">
        <section class="home-hero">
          <img
            alt=""
            aria-hidden="true"
            class="home-stripes"
            src="/convex-auth/brand/racing-lines.png"
          />
          <div class="home-hero-inner">
            <div class="home-copy">
              <h1>
                <span>Convex-Auth</span>
                <span>By Estifanos</span>
              </h1>
              <p class="lede">the unofficial auth solution for convex</p>
              <div class="home-actions">
                <a class="cta-ghost" href="/convex-auth/getting-started/installation/">
                  Read the docs
                </a>
                <a class="cta-solid" href="/convex-auth/getting-started/installation/">
                  Start building
                </a>
              </div>
            </div>
            <aside aria-label="Install convex-auth" class="palette">
              <div class="palette-row">
                <p class="palette-label">Start a new Convex Auth project</p>
                <button class="palette-command" onClick={() => void copy()} type="button">
                  <code>{installCommand}</code>
                  <span>{copied() ? "Copied" : <CopyIcon />}</span>
                </button>
              </div>
              <div class="palette-row">
                <p class="palette-label">Build anything with Convex</p>
                <a class="palette-command" href="/convex-auth/getting-started/providers/">
                  <code>providers · sso · passkeys · keys</code>
                  <span>→</span>
                </a>
              </div>
            </aside>
          </div>
        </section>
        <section class="home-rest">
          <div class="home-paths">
            <For each={paths}>
              {(path) => (
                <a class="path-card" href={path.href}>
                  <h2>{path.title}</h2>
                  <p>{path.body}</p>
                </a>
              )}
            </For>
          </div>
        </section>
      </main>
    </Chrome>
  );
}
