# react-workos example

This demo shows:

- The core component.
- The WorkOS component, with the `workos` method: enterprise SSO routed by
  the email's verified domain.
- The component's copy of WorkOS, kept from WorkOS's Events API, whose
  `dsync.user.*` changes sign a deprovisioned user out everywhere.

## Generate code / run

Run the example from its own directory.

```bash
cd examples/react-workos
npx convex dev --once    # provisions a deployment, generates convex/_generated
```

Then set `AUTH_WORKOS_CLIENT_ID` and `AUTH_WORKOS_API_KEY` on the deployment,
add `<site-url>/workos/callback` as a redirect URI in the WorkOS dashboard,
and fill the copy:

```bash
npx convex run workos:sync
```

To keep it current, add a webhook endpoint at `<site-url>/ring` in the WorkOS
dashboard for the `dsync.*`, `organization*` and `connection.*` events. A
delivery only rings a sync; the sync reads the events from WorkOS's API.
