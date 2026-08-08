# convex-auth Svelte demo

The live demo for `@estifanos-sh/convex-auth`, served at
[estifanos.sh/convex-auth/demo/](https://estifanos.sh/convex-auth/demo/).
It is a SvelteKit static SPA backed by the repository's root Convex deployment.

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

The app uses `/demo` as its SvelteKit base path so the documentation and demo
can share one Convex static-hosting origin.

## Deploy

```bash
vp run deploy:demo
```

This deploys the production Convex backend and uploads `demos/svelte/build` to
Convex static hosting. Use `vp run deploy:demo:dev` for a development upload.
