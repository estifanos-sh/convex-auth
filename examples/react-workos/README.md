# react-workos example

This demo shows:

- The core component.
- The WorkOS component, with the `workos` method: enterprise SSO routed by
  the email's verified domain.
- The directory sync, with a handler that keeps each user's directory state
  and signs a deprovisioned user out everywhere.

## Generate code / run

Run the example from its own directory.

```bash
cd examples/react-workos
npx convex dev --once    # provisions a deployment, generates convex/_generated
```

Then set `AUTH_WORKOS_CLIENT_ID` and `AUTH_WORKOS_API_KEY` (and, for the
webhook, `AUTH_WORKOS_WEBHOOK_SECRET`) on the deployment, and in the WorkOS
dashboard add `<site-url>/workos/callback` as a redirect URI and
`<site-url>/workos/webhook` as a webhook endpoint for the `dsync.*`,
`connection.*`, `organization.*` and `organization_domain.*` events.
