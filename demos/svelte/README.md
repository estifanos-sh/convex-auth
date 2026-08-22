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

## Deployment

This repository does not deploy the demo from CI. If the demo is hosted again,
give it a dedicated Convex project and deployment workflow; it must not share
the estifanos.sh landing/docs deployment.
