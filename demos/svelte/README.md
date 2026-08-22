# convex-auth Svelte demo

This SvelteKit static SPA exercises `@estifanos-sh/convex-auth` against the
repository's Convex backend.

## Work locally

Run commands from the repository root:

```bash
vp install
vp run dev:svelte
```

Start the Convex development process separately. The Svelte app reads the root
environment files and generated Convex API.

## Validate

```bash
vp run check:demo
vp run build:demo
```

The app uses `/demo` as its SvelteKit base path.

## Deploy

```bash
vp run deploy:demo
```

The GitHub workflow is manual-only and uses the isolated `demo` environment.
Configure that environment with a deploy key for a dedicated Convex project
before running it. The estifanos.sh landing/docs deployment is a different
project and must never be used for this demo. Use `vp run deploy:demo:dev` for a
development upload.
