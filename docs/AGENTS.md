## Documentation content

- `docs.json` is the declarative site and navigation configuration.
- `content/**/*.md` is the canonical documentation source. A page at
  `content/api/request.md` has the slug `/api/request`.
- Keep every content page in the configured sidebar.
- Use YAML frontmatter as the sole source for a page title and description.
  Do not repeat the title as a leading Markdown H1.
- Write framework-independent CommonMark. Do not use Svelte, Astro, MDX, or
  other framework markup or imports, including `<svelte:head>`, `<script>`
  preludes, or custom components. Framework syntax belongs only inside fenced
  code examples when the page is documenting that framework.
- Documentation framework code, generated files, search indexing, and deployment live in
  `estifanos-sh/estifanos-sh`.
- Do not add a package manifest, application code, generated output, or deployment credentials here.
