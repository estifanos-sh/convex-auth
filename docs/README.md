# convex-auth documentation

This directory owns the content for
[estifanos.sh/convex-auth](https://estifanos.sh/convex-auth/).

- `docs.json` defines product metadata, home-page links, and sidebar navigation.
- `content/**/*.md` contains framework-independent CommonMark documentation.
  For example, `content/api/request.md` is served at `/api/request`.

Each page uses YAML frontmatter for its `title` and `description`; do not add a
duplicate leading H1. Do not add framework markup or imports such as
`<svelte:head>`, `<script>` preludes, Astro/MDX components, or Svelte
components. Framework-specific syntax is appropriate only inside fenced code
examples that document that framework.

The shared renderer, Markdown compiler, Pagefind integration, `llms.txt`
generation, and production deployment belong to `estifanos-sh/estifanos-sh`.
This repository contains no documentation application or hosting credentials.
