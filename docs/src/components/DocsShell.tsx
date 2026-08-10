import { For, Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import { useRouterState } from "@tanstack/solid-router";
import type { DocumentationPage } from "../generated/docs";
import { sidebar } from "../config/sidebar";

interface SearchResult {
  url: string;
  title: string;
  excerpt: string;
  section: string;
}

function sectionFor(url: string) {
  const clean = url.replace(/^\/convex-auth/, "").replace(/\/$/, "");
  return sidebar.find((group) => group.items.some((item) => item.slug === clean))?.label || "";
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

  onMount(() => {
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
          <div class="docs-brand" aria-label="estifanos.sh convex-auth documentation">
            <span class="site-mark" aria-hidden="true" />
            <span class="docs-site-context">estifanos.sh / </span>
            <span>convex-auth</span>
          </div>
          <div class="docs-actions">
            <button class="header-action" onClick={openSearch}>
              Search
            </button>
            <button
              aria-controls="mobile-docs-nav"
              aria-expanded={menuOpen()}
              class="header-action menu-button"
              onClick={() => setMenuOpen(!menuOpen())}
            >
              Menu
            </button>
            <a class="site-switch" href="https://estifanos.com/">
              com
            </a>
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
              <button class="header-action close-button" onClick={() => setMenuOpen(false)}>
                Close
              </button>
              <Nav current={pathname()} onNavigate={() => setMenuOpen(false)} />
            </nav>
          </div>
        </Show>
        <main class="docs-main" id="main-content">
          <article
            class="doc-content"
            data-pagefind-body
            ref={(element) => {
              article = element;
            }}
            tabindex="-1"
            innerHTML={props.page.html}
          />
        </main>
      </div>
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
                {" "}
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
