import { For, Show, createEffect, createMemo, on, onMount } from "solid-js";
import { adjacentPages, sectionFor } from "../config/sidebar";
import type { DocumentationPage } from "../generated/docs";
import { Chrome } from "./chrome";

interface PageHeading {
  id: string;
  title: string;
}

function headingsFromHtml(html: string): PageHeading[] {
  return [...html.matchAll(/<h2 id="([^"]*)"[^>]*>([\s\S]*?)<\/h2>/g)].map((match) => ({
    id: match[1],
    title: match[2].replace(/<[^>]+>/g, "").trim(),
  }));
}

function mountCodeCopy(root: HTMLElement) {
  for (const pre of root.querySelectorAll<HTMLElement>("pre")) {
    if (pre.parentElement?.classList.contains("code-block")) continue;
    const wrap = document.createElement("div");
    wrap.className = "code-block";
    pre.replaceWith(wrap);
    wrap.append(pre);
    const button = document.createElement("button");
    button.className = "code-copy";
    button.type = "button";
    button.textContent = "Copy";
    button.addEventListener("click", () => {
      void navigator.clipboard.writeText(pre.textContent || "").then(() => {
        button.textContent = "Copied";
        window.setTimeout(() => {
          button.textContent = "Copy";
        }, 1600);
      });
    });
    wrap.append(button);
  }
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
  const section = () => sectionFor(`/convex-auth${props.page.slug}`);
  const adjacent = () => adjacentPages(props.page.slug);
  const headings = createMemo(() => headingsFromHtml(props.page.html));

  onMount(() => {
    if (article) {
      mountTabs(article);
      mountCodeCopy(article);
    }
  });
  createEffect(
    on(
      () => props.page.html,
      () =>
        queueMicrotask(() => {
          if (!article) return;
          mountTabs(article);
          mountCodeCopy(article);
        }),
    ),
  );

  return (
    <Chrome withSidebar>
      <main class="doc-pane" id="main-content">
        <div class="doc-grid">
          <div class="doc-content">
            <header class="doc-hero">
              <Show when={section()}>
                <p class="eyebrow">{section()}</p>
              </Show>
              <h1>{props.page.title}</h1>
              <p class="lede">{props.page.description}</p>
            </header>
            <article
              class="doc-prose"
              data-pagefind-body
              ref={(element) => {
                article = element;
              }}
              tabindex="-1"
              innerHTML={props.page.html}
            />
            <nav class="pager" aria-label="Adjacent documentation pages">
              <Show when={adjacent().previous}>
                {(previous) => (
                  <a class="pager-link" href={`/convex-auth${previous().slug}/`}>
                    <span>Previous</span>
                    <strong>{previous().title}</strong>
                  </a>
                )}
              </Show>
              <Show when={adjacent().next}>
                {(next) => (
                  <a class="pager-link pager-next" href={`/convex-auth${next().slug}/`}>
                    <span>Next</span>
                    <strong>{next().title}</strong>
                  </a>
                )}
              </Show>
            </nav>
          </div>
          <Show when={headings().length}>
            <nav aria-label="On this page" class="outline">
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
    </Chrome>
  );
}
