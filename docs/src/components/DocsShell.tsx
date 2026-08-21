import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { useRouterState } from "@tanstack/solid-router";
import type { DocumentationPage } from "../generated/docs";
import { sidebar } from "../config/sidebar";

interface SearchResult {
  url: string;
  title: string;
  excerpt: string;
  section: string;
}

interface PageHeading {
  id: string;
  title: string;
}

function sectionFor(url: string) {
  const clean = url.replace(/^\/convex-auth/, "").replace(/\/$/, "");
  return sidebar.find((group) => group.items.some((item) => item.slug === clean))?.label || "";
}

const navigationItems = sidebar.flatMap((group) =>
  group.items.map((item) => ({ ...item, section: group.label })),
);

function adjacentPages(slug: string) {
  const currentIndex = navigationItems.findIndex((item) => item.slug === slug);
  return {
    next: currentIndex >= 0 ? navigationItems[currentIndex + 1] : undefined,
    previous: currentIndex > 0 ? navigationItems[currentIndex - 1] : undefined,
  };
}

function headingsFromHtml(html: string): PageHeading[] {
  return [...html.matchAll(/<h2 id="([^"]*)"[^>]*>([\s\S]*?)<\/h2>/g)].map((match) => ({
    id: match[1],
    title: match[2].replace(/<[^>]+>/g, "").trim(),
  }));
}

function mountTabs(root: HTMLElement) {
  for (const tabs of root.querySelectorAll<HTMLElement>("[data-tabs]")) {
    const panels = [...tabs.querySelectorAll<HTMLElement>("[data-tab]")];
    if (!panels.length || tabs.querySelector("[role=tablist]")) continue;
    const bar = document.createElement("div");
    bar.className = "tab-bar";
    bar.setAttribute("role", "tablist");
    panels.forEach((panel, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = panel.dataset.tab || `Tab ${index + 1}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(index === 0));
      panel.hidden = index !== 0;
      button.addEventListener("click", () => {
        panels.forEach((candidate, candidateIndex) => {
          candidate.hidden = candidateIndex !== index;
          bar.children[candidateIndex].setAttribute(
            "aria-selected",
            String(candidateIndex === index),
          );
        });
      });
      bar.append(button);
    });
    tabs.prepend(bar);
  }
}

function currentTheme(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function DocsShell(props: { page: DocumentationPage }) {
  let article: HTMLElement | undefined;
  let input: HTMLInputElement | undefined;
  const pathname = useRouterState({
    select: (state) =>
      state.location.pathname.replace(/^\/convex-auth/, "").replace(/\/$/, "") || "/",
  });
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [theme, setTheme] = createSignal<"light" | "dark">("light");
  const section = () => sectionFor(`/convex-auth${props.page.slug}`);
  const adjacent = () => adjacentPages(props.page.slug);
  const headings = createMemo(() => headingsFromHtml(props.page.html));
  let pagefind:
    | {
        init: () => Promise<void>;
        search: (query: string) => Promise<{
          results: Array<{
            data: () => Promise<{ url: string; meta?: { title?: string }; excerpt: string }>;
          }>;
        }>;
      }
    | undefined;

  const openSearch = () => {
    setMenuOpen(false);
    setSearchOpen(true);
    queueMicrotask(() => input?.focus());
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    setResults([]);
    setActiveIndex(0);
  };
  const search = async (value: string) => {
    setQuery(value);
    if (!pagefind || !value.trim()) {
      setResults([]);
      return;
    }
    const response = await pagefind.search(value);
    setResults(
      await Promise.all(
        response.results.slice(0, 6).map(async (result) => {
          const data = await result.data();
          return {
            excerpt: data.excerpt
              .replace(/<[^>]+>/g, "")
              .replace(/\s+/g, " ")
              .trim(),
            section: sectionFor(data.url),
            title: data.meta?.title || data.url,
            url: data.url,
          };
        }),
      ),
    );
    setActiveIndex(0);
  };
  const toggleTheme = () => {
    const next = theme() === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem("convex-auth-theme", next);
  };

  onMount(() => {
    setTheme(currentTheme());
    if (article) mountTabs(article);
    void import(/* @vite-ignore */ `${import.meta.env.BASE_URL}pagefind/pagefind.js`)
      .then(async (module) => {
        const loaded = module as typeof pagefind;
        pagefind = loaded;
        await loaded?.init();
      })
      .catch(() => undefined);
    const handleKeydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (searchOpen()) closeSearch();
        else openSearch();
      }
      if (event.key === "Escape") {
        closeSearch();
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeydown);
    onCleanup(() => window.removeEventListener("keydown", handleKeydown));
  });
  createEffect(
    on(
      () => props.page.html,
      () => queueMicrotask(() => article && mountTabs(article)),
    ),
  );

  return (
    <>
      <a class="skip-link" href="#main-content">
        Skip to documentation
      </a>
      <header class="docs-header">
        <div class="docs-header-inner">
          <a class="docs-brand" href="/convex-auth/getting-started/installation/">
            <img
              alt=""
              class="brand-symbol brand-symbol-light"
              height="27"
              src="/convex-auth/brand/symbol-color.svg"
              width="27"
            />
            <img
              alt=""
              class="brand-symbol brand-symbol-dark"
              height="27"
              src="/convex-auth/brand/symbol-white.svg"
              width="27"
            />
            <span class="brand-copy">
              <span class="brand-word">convex</span>
              <span class="brand-product">Auth</span>
            </span>
          </a>
          <div class="docs-actions">
            <button class="search-trigger" onClick={openSearch} type="button">
              <SearchIcon />
              <span>Search</span>
              <kbd>⌘K</kbd>
            </button>
            <a
              aria-label="GitHub repository"
              class="header-link"
              href="https://github.com/estifanos-sh/convex-auth"
            >
              <GitHubIcon />
            </a>
            <button
              aria-label={theme() === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              class="icon-button"
              onClick={toggleTheme}
              type="button"
            >
              <Show when={theme() === "dark"} fallback={<MoonIcon />}>
                <SunIcon />
              </Show>
            </button>
            <button
              aria-controls="mobile-docs-nav"
              aria-expanded={menuOpen()}
              aria-label="Open documentation menu"
              class="icon-button menu-button"
              onClick={() => setMenuOpen(!menuOpen())}
              type="button"
            >
              <MenuIcon />
            </button>
          </div>
        </div>
      </header>
      <div class="docs-layout">
        <aside class="sidebar">
          <Nav current={pathname()} />
        </aside>
        <Show when={menuOpen()}>
          <div class="mobile-layer">
            <button
              aria-label="Close navigation"
              class="scrim"
              onClick={() => setMenuOpen(false)}
            />
            <nav class="mobile-nav" id="mobile-docs-nav">
              <button
                aria-label="Close navigation"
                class="icon-button close-button"
                onClick={() => setMenuOpen(false)}
                type="button"
              >
                <CloseIcon />
              </button>
              <Nav current={pathname()} onNavigate={() => setMenuOpen(false)} />
            </nav>
          </div>
        </Show>
        <main class="docs-main" id="main-content">
          <div class="doc-canvas">
            <div>
              <header class="doc-header">
                <Show when={section()}>
                  <p class="doc-section">{section()}</p>
                </Show>
                <h1>{props.page.title}</h1>
                <p class="doc-description">{props.page.description}</p>
              </header>
              <article
                class="doc-content"
                data-pagefind-body
                ref={(element) => {
                  article = element;
                }}
                tabindex="-1"
                innerHTML={props.page.html}
              />
              <nav class="doc-pagination" aria-label="Adjacent documentation pages">
                <Show when={adjacent().previous}>
                  {(previous) => (
                    <a
                      class="doc-pagination-link doc-pagination-previous"
                      href={`/convex-auth${previous().slug}/`}
                    >
                      <span>Previous</span>
                      <strong>{previous().title}</strong>
                    </a>
                  )}
                </Show>
                <Show when={adjacent().next}>
                  {(next) => (
                    <a
                      class="doc-pagination-link doc-pagination-next"
                      href={`/convex-auth${next().slug}/`}
                    >
                      <span>Next</span>
                      <strong>{next().title}</strong>
                    </a>
                  )}
                </Show>
              </nav>
            </div>
            <Show when={headings().length}>
              <nav aria-label="On this page" class="toc">
                <h2>On this page</h2>
                <ol>
                  <For each={headings()}>
                    {(heading) => (
                      <li>
                        <a href={`#${heading.id}`}>{heading.title}</a>
                      </li>
                    )}
                  </For>
                </ol>
              </nav>
            </Show>
          </div>
        </main>
      </div>
      <footer class="docs-footer">
        <span>Authentication infrastructure for Convex apps.</span>
        <a href="https://www.convex.dev">convex.dev</a>
        <a href="https://docs.convex.dev">Convex docs</a>
        <a href="https://github.com/estifanos-sh/convex-auth">GitHub</a>
      </footer>
      <Show when={searchOpen()}>
        <div class="search-layer">
          <button aria-label="Close search" class="scrim" onClick={closeSearch} />
          <section
            aria-label="Search documentation"
            aria-modal="true"
            class="search-panel"
            role="dialog"
          >
            <div class="search-input">
              <SearchIcon />
              <input
                ref={(element) => {
                  input = element;
                }}
                aria-label="Search documentation"
                onInput={(event) => void search(event.currentTarget.value)}
                placeholder="Search documentation"
                value={query()}
              />
              <kbd>ESC</kbd>
            </div>
            <Show
              when={results().length}
              fallback={
                <Show when={query()}>
                  <p class="no-results">No results for “{query()}”</p>
                </Show>
              }
            >
              <ol class="search-results">
                <For each={results()}>
                  {(result, index) => (
                    <li>
                      <a
                        aria-current={activeIndex() === index() ? "true" : undefined}
                        href={result.url}
                        onMouseEnter={() => setActiveIndex(index())}
                      >
                        <Show when={result.section}>
                          <small>{result.section}</small>
                        </Show>
                        <strong>{result.title}</strong>
                        <span>{result.excerpt}</span>
                      </a>
                    </li>
                  )}
                </For>
              </ol>
            </Show>
          </section>
        </div>
      </Show>
    </>
  );
}

function Nav(props: { current: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Documentation">
      <For each={sidebar}>
        {(group) => (
          <section class="nav-group">
            <h2>{group.label}</h2>
            <ul>
              <For each={group.items}>
                {(item) => (
                  <li>
                    <a
                      aria-current={props.current === item.slug ? "page" : undefined}
                      classList={{ active: props.current === item.slug }}
                      href={`/convex-auth${item.slug}/`}
                      onClick={props.onNavigate}
                    >
                      {item.title}
                    </a>
                  </li>
                )}
              </For>
            </ul>
          </section>
        )}
      </For>
    </nav>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" stroke-width="1.5" />
      <path
        d="m10.2 10.2 3.05 3.05"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="1.5"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="16" viewBox="0 0 16 16" width="16">
      <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.89-1.18-.89-1.18-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.89.87 2.35.66.07-.52.28-.87.51-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.54 7.54 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
      <circle cx="8" cy="8" r="3.1" stroke="currentColor" stroke-width="1.5" />
      <path
        d="M8 1.4v1.4M8 13.2v1.4M1.4 8h1.4M13.2 8h1.4M3.2 3.2l1 1M11.8 11.8l1 1M3.2 12.8l1-1M11.8 4.2l1-1"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="1.5"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
      <path
        d="M13.3 10.2A5.4 5.4 0 1 1 5.8 2.7 4.3 4.3 0 0 0 13.3 10.2Z"
        stroke="currentColor"
        stroke-linejoin="round"
        stroke-width="1.5"
      />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
      <path
        d="M2.5 4.25h11M2.5 8h11M2.5 11.75h11"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="1.5"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
      <path
        d="m4 4 8 8M12 4 4 12"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="1.5"
      />
    </svg>
  );
}
