# convex-auth documentation

This package is a TanStack Start + SolidJS static documentation application for
`@estifanos-sh/convex-auth`. Markdown under `src/content/` is the canonical
source; `scripts/content/compile.ts` parses it with Unified/Remark MDX and
builds Shiki-highlighted HTML before the app is compiled.

```sh
vp run --filter docs check
vp run build:docs
```

The production artifact is `docs/dist/client/convex-auth/`. It contains
directory-index pages for `/convex-auth/` and every documentation route,
Pagefind, `.md` aliases, `llms.txt`, and `llms-full.txt`; it can be copied into
the landing build directly without a second prefix.

## Publishing

This repository owns the documentation source and build contract, but it does
not upload the production site. The `estifanos-sh/estifanos-sh` release workflow
checks out an explicit Convex Auth revision, builds this artifact, combines it
with the other project sites, and performs the only production upload. Never
upload this directory by itself: the production static-hosting manifest is
shared and atomic.
