---
name: robelest-convex-auth-review
description: Review an existing @robelest/convex-auth integration for security, correctness, API-version drift, authorization gaps, provider and client misconfiguration, session or token flaws, WebAuthn trust mistakes, OAuth or MCP protocol issues, enterprise connection exposure, and production readiness. Use for code review, launch readiness, incident diagnosis, migration review, or requests to harden Convex authentication. Produce evidence-backed findings before changing code.
---

# Review Robelest Convex Auth

Audit the integration as a trust-boundary system. Report concrete, reachable
problems with file and line evidence; do not produce a generic auth checklist.

## 1. Define the review boundary

Determine whether the user requested findings only or also authorized fixes.
Inspect project instructions, git state, diff/base, framework, target
deployments, and installed `@robelest/convex-auth` version. Preserve unrelated
work.

Distinguish this package from `@convex-dev/auth`. Compare code to the installed
exports and `.d.ts` before using current online docs. Identify version drift as
drift, not automatically as a defect.

## 2. Map the authentication flow

Trace one complete request through:

1. provider or credential ceremony;
2. `defineAuth` and its server environment;
3. mounted HTTP routes and callback/origin handling;
4. session or token issuance and `auth.config.*` trust;
5. browser/native storage and refresh lifecycle;
6. Convex identity resolution;
7. application authorization and protected data access.

Also enumerate public Convex functions, HTTP endpoints, OAuth/MCP surfaces,
group connection administration, API keys, and factor-management endpoints.
Untraced exposure is a review gap.

## 3. Test hypotheses, not keywords

Read [references/review.md](references/review.md). For each suspected issue:

- identify the attacker or failure precondition;
- follow the actual call path and data boundary;
- check existing validation, indexes, authorization, and transactional guards;
- construct the smallest positive or negative test that proves reachability;
- discard findings that cannot survive this check.

Use `pnpx @robelest/convex-auth doctor` as one signal, not as a substitute for
code and protocol review.

## 4. Prioritize findings

Use these levels:

- **Critical**: practical account takeover, signing-key or credential exposure,
  broad cross-tenant access, or production auth bypass.
- **High**: reachable authorization bypass, replay, redirect/token confusion,
  unsafe account linking, or security-policy enforcement failure.
- **Medium**: meaningful defense-in-depth gap, denial of service, session-policy
  weakness, or configuration likely to fail in production.
- **Low**: localized correctness, maintainability, observability, or DX defect
  with limited security impact.

Do not inflate severity because the code is authentication-related.

## 5. Report before broad remediation

Order findings by severity. For each finding include:

- concise title and severity;
- exact file and tight line range;
- current behavior and triggering path;
- impact;
- smallest correct remediation;
- test that would prevent regression.

Separate confirmed findings, unverified risks requiring environment access, and
non-blocking improvements. If authorized to fix, implement only confirmed
issues, then rerun the relevant negative tests and the repository checks.

## Completion checklist

- Installed version and review base recorded
- Full sign-in-to-authorization path traced
- Public and protocol surfaces enumerated
- Tenant, ownership, and grant boundaries checked
- Secrets, origins, callbacks, and production configuration checked
- Session, account-linking, and factor lifecycle checked
- WebAuthn claims distinguished from verified attestation
- Positive and adversarial tests considered
- Findings are reachable, line-specific, and deduplicated
- Residual risks and unavailable external evidence stated
