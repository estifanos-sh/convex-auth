import { For, Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { useRouterState } from "@tanstack/solid-router";
import { sidebar } from "../config/sidebar";
import { CloseIcon, GitHubIcon, MenuIcon, SearchIcon } from "./icons";

interface SearchResult {
  excerpt: string;
  section: string;
  title: string;
  url: string;
}

export function Chrome(props: { children: JSX.Element; landing?: boolean; withSidebar?: boolean }) {
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
            data: () => Promise<{ excerpt: string; meta?: { title?: string }; url: string }>;
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
          const url = data.url;
          return {
            excerpt: data.excerpt
              .replace(/<[^>]+>/g, "")
              .replace(/\s+/g, " ")
              .trim(),
            section:
              sidebar.find((group) => group.items.some((item) => url.includes(item.slug)))?.label ||
              "",
            title: data.meta?.title || data.url,
            url: data.url,
          };
        }),
      ),
    );
    setActiveIndex(0);
  };
  onMount(() => {
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

  return (
    <div
      classList={{ chrome: true, "chrome-docs": props.withSidebar, "chrome-home": props.landing }}
    >
      <a class="skip-link" href="#main-content">
        Skip to content
      </a>
      <header class="masthead">
        <a class="brand-lockup" href="/convex-auth/">
          <img
            alt="Convex"
            class="brand-wordmark"
            height="36"
            src="/convex-auth/brand/convex-logo-white.svg"
            width="92"
          />
        </a>
        <div class="masthead-actions">
          <button class="search-chip" onClick={openSearch} type="button">
            <SearchIcon />
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>
          <a class="github-button" href="https://github.com/estifanos-sh/convex-auth">
            <GitHubIcon />
            <span>GitHub</span>
          </a>
          <Show when={props.withSidebar}>
            <button
              aria-controls="mobile-docs-nav"
              aria-expanded={menuOpen()}
              aria-label="Open documentation menu"
              class="icon-btn menu-btn"
              onClick={() => setMenuOpen(!menuOpen())}
              type="button"
            >
              <MenuIcon />
            </button>
          </Show>
        </div>
      </header>
      <Show when={props.withSidebar}>
        <section class="brand-strip" aria-label="Convex Auth by Estifanos">
          <div class="brand-strip-inner">
            <p class="brand-strip-title">
              Convex Auth <span>By Estifanos</span>
            </p>
            <p class="brand-strip-deck">The unofficial Convex authentication solution.</p>
          </div>
        </section>
      </Show>
      <div classList={{ "docs-frame": true, "docs-frame-home": !props.withSidebar }}>
        <Show when={props.withSidebar}>
          <aside class="rail">
            <Sidebar current={pathname()} />
          </aside>
        </Show>
        <Show when={menuOpen()}>
          <div class="overlay">
            <button
              aria-label="Close navigation"
              class="scrim"
              onClick={() => setMenuOpen(false)}
            />
            <nav class="drawer" id="mobile-docs-nav">
              <button
                aria-label="Close navigation"
                class="icon-btn drawer-close"
                onClick={() => setMenuOpen(false)}
                type="button"
              >
                <CloseIcon />
              </button>
              <Sidebar current={pathname()} onNavigate={() => setMenuOpen(false)} />
            </nav>
          </div>
        </Show>
        {props.children}
      </div>
      <footer class="site-foot">
        <div class="site-foot-inner">
          <div class="site-foot-primary">
            <p class="site-foot-built">
              Built with <span aria-label="love">♥</span> by
              <a href="https://estifanos.com">estifanos.com</a>
            </p>
          </div>
          <nav aria-label="Footer" class="site-foot-links">
            <a href="/convex-auth/getting-started/installation/">Installation</a>
            <a href="https://github.com/estifanos-sh/convex-auth">GitHub</a>
          </nav>
        </div>
      </footer>
      <Show when={searchOpen()}>
        <div class="overlay search-overlay">
          <button aria-label="Close search" class="scrim" onClick={closeSearch} />
          <section
            aria-label="Search documentation"
            aria-modal="true"
            class="search-sheet"
            role="dialog"
          >
            <div class="search-field">
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
                  <p class="search-empty">No results for “{query()}”</p>
                </Show>
              }
            >
              <ol class="search-hits">
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
    </div>
  );
}

export function Sidebar(props: { current: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Documentation">
      <For each={sidebar}>
        {(group) => {
          const active = () => group.items.some((item) => props.current === item.slug);
          return (
            <details class="rail-group" open={active()}>
              <summary>{group.label}</summary>
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
            </details>
          );
        }}
      </For>
    </nav>
  );
}
