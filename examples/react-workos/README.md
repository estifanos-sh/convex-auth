# react-workos example

This demo shows:

- The core component.
- The WorkOS component, signing in through WorkOS AuthKit.

## Generate code / run

Run the example from its own directory.

```bash
cd examples/react-workos
npx convex dev --once    # provisions a deployment, generates convex/_generated
npx @convex-dev/auth     # sets AUTH_PRIVATE_KEY + AUTH_JWKS on the deployment
npx convex env set AUTH_WORKOS_CLIENT_ID client_...
npx convex env set AUTH_WORKOS_API_KEY sk_...
```

Add `https://<deployment>.convex.site/oauth/workos/callback` as a redirect URI
in the WorkOS dashboard.

## Test usage

The tests defined in the example are run along with `pnpm test` in the repo root.
