## Documentation application

- Language: TypeScript
- Runtime: TanStack Start with Solid
- Package manager: pnpm through Vite+ (`vp`)
- Rendering: prerendered static pages under `/convex-auth/`
- Search: Pagefind generated after the static build

The Markdown files in `src/content` are the source of truth. Run
`vp run --filter docs check` after content or component changes and
`vp run build:docs` before changing the hosting integration.

Keep browser state local to the documentation shell. The site must not depend
on Convex queries, global history state, or synthetic scroll containers.
