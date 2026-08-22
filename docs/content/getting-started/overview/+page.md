---
title: Overview
description: Add authentication and authorization to a Convex application without giving up control of application policy.
---

# Overview

Convex Auth is an authentication and authorization component for Convex applications. It manages identities, sessions, credentials, and enterprise connections while your application owns provider configuration, authorization policy, and user-facing flows.

## What Convex Auth provides

- server APIs for users, sessions, accounts, factors, groups, members, invites, and keys
- browser, React, Svelte, Expo, and server-rendering clients
- password, OAuth, email, phone, passkey, TOTP, and anonymous sign-in flows
- OIDC, SAML, SCIM, connection policy, audit, and webhook support
- typed configuration, errors, events, and return values

## How it fits into a Convex application

The application installs the component and mounts the generated HTTP routes. Provider secrets and delivery services stay in the application, so Convex Auth does not reserve environment-variable names or bundle a vendor-specific email or identity service.

Ordinary queries and mutations import the generated auth context. That context resolves the current identity and exposes the authorization surface without requiring application code to read authentication tables directly.

## Start here

Continue to [Installation](/getting-started/installation) to add the component and run the setup CLI. Then configure at least one [provider](/getting-started/providers) and choose the client integration for your application.
