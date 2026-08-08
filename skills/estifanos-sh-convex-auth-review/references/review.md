# Review guide

Use the sections relevant to the integration. Confirm every issue against the
installed package version and actual call path.

## Server definition and environment

- Confirm one canonical `defineAuth` definition and the expected component
  registration.
- Confirm secrets come from server-only generated environment values and never
  enter browser bundles, logs, errors, source control, or component tables.
- Confirm development, preview, and production use distinct origins and
  credentials where providers require them.
- Confirm key generation and rotation preserve active-session and rollback
  expectations.
- Confirm `auth.config.*` trusts the exact issuer produced by mounted routes.

## Function and data authorization

- Enumerate public queries, mutations, actions, and HTTP endpoints.
- Derive the acting user from authenticated context, never `args.userId`.
- For document access, check ownership or membership on the requested document,
  not merely that some identity exists.
- For group-scoped operations, bind the target resource to the authorized
  `groupId`; reject cross-group IDs.
- Keep connection, SCIM, OAuth-client, API-key, invite, role, and factor
  administration behind app-owned wrappers with explicit grants.
- Check list queries for tenant filters, pagination, and accidental PII return.
- Check time-of-check/time-of-use boundaries and whether related writes need a
  single mutation transaction.

## Sessions, tokens, and account linking

- Check expiry, refresh rotation, reuse detection, revocation, and concurrent
  refresh behavior.
- Verify sign-out revokes or discards every credential expected by the product.
- Check session fixation across anonymous-to-identified upgrades.
- Verify account linking requires evidence controlled by the same user; do not
  link solely on an unverified email claim.
- Check OAuth state, PKCE, nonce, redirect URI equality, token endpoint client
  authentication, and one-time code consumption.
- Ensure logs and structured errors do not reveal passwords, OTPs, refresh
  tokens, API-key secrets, authorization codes, or registration tokens.

## Password, email, phone, and TOTP

- Verify secret hashing parameters and constant-time verification come from the
  provider implementation rather than app-owned replacement code.
- Check enumeration resistance and rate limits on sign-in, reset, delivery, and
  verification.
- Bind OTPs to their flow, identifier, expiry, and one-time use.
- Check reset and password-change behavior invalidates the intended sessions.
- Require recent authentication for sensitive factor changes where appropriate.
- Ensure recovery behavior cannot bypass the stronger factor policy.

## WebAuthn and passkeys

- Validate RP ID, expected origins, challenge expiry and single use, user
  verification, credential ownership, signature counter policy, and duplicate
  registration handling.
- Treat `authenticatorAttachment: "cross-platform"` and
  `hints: ["security-key"]` as browser guidance, not hardware proof.
- If policy requires trusted hardware, require direct/enterprise attestation as
  appropriate, verify the attestation statement and certificate chain against
  explicit trust roots or trusted metadata, and persist the verified AAGUID and
  trust result.
- Do not accept an AAGUID allowlist alone as provenance; it is assertion data
  unless cryptographically bound by verified attestation.
- Treat missing, self, none, or untrusted attestation according to explicit
  policy. Do not silently downgrade a `requireTrusted` policy.
- Credentials created before evidence was stored remain untrusted until a
  supported re-enrollment or re-verification process establishes trust.

## Browser, native, and SSR clients

- Confirm exactly one auth client owns token refresh and Convex `setAuth`.
- Check secure storage choice, cross-tab coordination, stale callback cleanup,
  and race behavior during refresh and sign-out.
- Validate cookie `Secure`, `HttpOnly`, `SameSite`, domain, path, and expiry
  against the deployment model.
- Check SSR direct loads and hydration for identity confusion or token leakage.
- Validate native deep links, claimed HTTPS domains, and physical-device flows.

## MCP OAuth and app-as-authorization-server

- Validate authorization-server and protected-resource discovery metadata.
- Bind access tokens to the intended resource and validate scopes per tool.
- Check dynamic client registration and management-token lifecycle.
- Confirm consent uses the authenticated caller, not a submitted user ID.
- Check public clients require PKCE and cannot use confidential-client flows.
- Keep MCP tool authorization inside each handler even when the token is valid.

## Enterprise connections

- Authorize every connection, domain, policy, SAML/OIDC, SCIM, audit, and
  webhook administration call against its group.
- Verify domain ownership before activation and prevent cross-tenant connection
  selection.
- Check SAML signature requirements, certificate pinning/rotation, audience,
  recipient, destination, issuer, and replay handling.
- Check OIDC issuer discovery, nonce/state, redirect binding, and profile claim
  verification.
- Authenticate SCIM bearer tokens, scope them to one connection/group, hash
  stored secrets, and make provisioning idempotent.
- Sign and retry webhooks safely without leaking payloads across tenants.

## Production evidence

- Run typecheck, build, focused unit tests, and a negative auth test.
- Exercise the actual browser or device ceremony for UI-facing providers.
- Verify discovery and callback endpoints on the intended deployment.
- Review deployment logs for secret redaction and actionable failure codes.
- Record external-console, hardware, DNS, or production checks that could not be
  performed locally.
