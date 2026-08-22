---
title: Overview
description: Add authentication and authorization to a Convex application without giving up control of application policy.
---

Convex Auth is an authentication and authorization component for Convex applications. It manages identities, sessions, credentials, and enterprise connections while your application owns provider configuration, authorization policy, and user-facing flows.

## What Convex Auth provides

Convex Auth provides one system for users, sessions, accounts, factors, groups,
members, invites, and keys. The same identity works through browser, React,
Svelte, Expo, and server-rendered clients. Password, OAuth, email, phone,
passkey, TOTP, anonymous, OIDC, SAML, and SCIM flows all resolve through the
same account and session model, with typed configuration, errors, events, and
return values at the application boundary.

## How it fits into a Convex application

The application installs the component and mounts the generated HTTP routes. Provider secrets and delivery services stay in the application, so Convex Auth does not reserve environment-variable names or bundle a vendor-specific email or identity service.

Ordinary queries and mutations import the generated auth context. That context resolves the current identity and exposes the authorization surface without requiring application code to read authentication tables directly.

## Start here

Continue to [Installation](/getting-started/installation) to add the component and run the setup CLI. Then configure at least one [provider](/getting-started/providers) and choose the client integration for your application.
