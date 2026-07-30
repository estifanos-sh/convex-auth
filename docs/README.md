# convex-auth documentation

The technical documentation for
[`@robelest/convex-auth`](https://www.npmjs.com/package/@robelest/convex-auth).
Production is served by Convex static hosting at
[convex-auth.estifanos.com](https://convex-auth.estifanos.com/).

## Work locally

Run commands from the repository root:

```bash
vp install
vp run --filter docs dev
```

The development server is only for the documentation frontend. The Convex
development process is managed separately.

## Validate

```bash
vp run --filter docs check
vp run build:docs
```

`build:docs` produces `docs/build`, generates the Pagefind search index, and
checks that the local fonts and static routes are present.

## Deploy

```bash
vp run deploy:docs
```

The root deployment task builds the package and docs, deploys the production
Convex backend, and uploads `docs/build` to the `docs` static-hosting component.
The demo is deployed separately at `/demo/`.
