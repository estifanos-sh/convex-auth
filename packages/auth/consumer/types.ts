import { definePermissions } from "@robelest/convex-auth/permissions";
import type {
  AuthApiRefs,
  ParamsForProvider,
  PlatformAuthClient,
} from "@robelest/convex-auth/client";
import { webauthn } from "@robelest/convex-auth/providers/webauthn";
// @ts-expect-error createAuth was hard-cut from the vNext public server API.
import { createAuth } from "@robelest/convex-auth/server";
import { authEnv, authEvents, defineAuth, type AuthEnv } from "@robelest/convex-auth/server";
import { defineApp, type HttpRouter } from "convex/server";
import { v, type GenericId } from "convex/values";

import { auth } from "../../../convex/auth";

declare const readCtx: Parameters<typeof auth.user.get>[0];
declare const eventCtx: Parameters<typeof auth.event.list>[0];
declare const memberCreateCtx: Parameters<typeof auth.member.create>[0];
declare const memberRequireCtx: Parameters<typeof auth.member.assert>[0];
declare const userUpdateCtx: Parameters<typeof auth.user.update>[0];
declare const memberUpdateCtx: Parameters<typeof auth.member.update>[0];
declare const keyCtx: Parameters<typeof auth.key.verify>[0];
declare const userId: string;
declare const groupId: string;
declare const memberId: string;
declare const keyId: string;
declare const secret: string;
declare const authEnvironment: AuthEnv;
declare const authComponent: Parameters<typeof defineAuth>[0];
declare const authUserId: GenericId<"User">;
declare const authGroupId: GenericId<"Group">;
declare const webauthnClient: PlatformAuthClient<AuthApiRefs<true, false, false>>;

void webauthnClient.webauthn.register({ name: "Security key" });
void webauthnClient.webauthn.signIn();

type Assert<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
type _DirectWebAuthnSignInIsDisabled = Assert<IsNever<ParamsForProvider<"webauthn">>>;
type _PasskeyClientWasRemoved = Assert<
  "passkey" extends keyof typeof webauthnClient ? false : true
>;
type UnknownFactorClient = Pick<
  PlatformAuthClient<AuthApiRefs<boolean, boolean, boolean>>,
  "webauthn" | "totp" | "device"
>;
const optionalFactors: UnknownFactorClient = {};
void optionalFactors.webauthn?.signIn();
void optionalFactors.totp?.setup();
void optionalFactors.device?.verify({ code: "ABCD-EFGH" });

const readonlyOrigins = ["https://app.example.com"] as const;
const readonlyWebAuthnHints = ["security-key"] as const;
const readonlyWebAuthnAlgorithms = [-7, -257] as const;
void webauthn({
  origin: readonlyOrigins,
  registration: {
    hints: readonlyWebAuthnHints,
    algorithms: readonlyWebAuthnAlgorithms,
  },
  authentication: { hints: readonlyWebAuthnHints },
});
webauthn({
  registration: {
    // @ts-expect-error The verifier supports only ES256 (-7) and RS256 (-257).
    algorithms: [-8],
  },
});

const permissions = definePermissions({
  grants: ["issues.read", "issues.write"],
  roles: {
    admin: { grants: ["issues.read", "issues.write"] },
  },
});

void defineApp({ env: authEnv });
void authEnvironment;
void permissions.roles.admin.id;
void createAuth;
void defineAuth(authComponent, {
  providers: [],
  events: authEvents.handlers({
    user: {
      created: async (_ctx, event) => {
        event.data.provider.toUpperCase();
        event.subject.type satisfies
          | "user"
          | "session"
          | "account"
          | "passkey"
          | "totp"
          | "email"
          | "phone"
          | "api_key"
          | "oauth_client"
          | "oauth_code"
          | "group"
          | "connection"
          | "scim_identity"
          | "webhook_endpoint"
          | "webhook_delivery"
          | "system";
      },
    },
    session: {
      signedIn: async (_ctx, event) => {
        event.data.provider.toUpperCase();
      },
    },
  }),
});

void auth.user.get(readCtx, { id: userId });
void auth.user.update(userUpdateCtx, { id: userId, patch: { name: "Alice" } });
void auth.member.create(memberCreateCtx, {
  data: { groupId, userId, roleIds: ["orgAdmin"] },
});
void auth.member.update(memberUpdateCtx, { id: memberId, patch: { roleIds: [] } });
void auth.member.assert(memberRequireCtx, { groupId, userId, grants: ["issues.edit"] });
void auth.key.get(readCtx, { id: keyId });
void auth.key.verify(keyCtx, { secret });
void auth.event.list(eventCtx, {
  where: (q) =>
    q
      .eq("target", authEvents.target.user(authUserId))
      .eq("kind", authEvents.session.signedIn)
      .eq("outcome", "success"),
  paginationOpts: { numItems: 10, cursor: null },
});

const readOnlyPermissions = definePermissions({
  grants: ["issues.read"],
  roles: {
    viewer: { grants: ["issues.read"] },
  },
});
type ReadOnlyGrant = (typeof readOnlyPermissions.grants)[number];
// @ts-expect-error read-only permissions should not infer undeclared grants.
const invalidReadOnlyGrant: ReadOnlyGrant = "issues.write";
void readOnlyPermissions.roles.viewer.id;
void invalidReadOnlyGrant;

// @ts-expect-error unknown role IDs are rejected by the configured permissions.
void auth.member.create(memberCreateCtx, { data: { groupId, userId, roleIds: ["owner"] } });

// @ts-expect-error unknown grants are rejected by the configured permissions.
void auth.member.assert(memberRequireCtx, { groupId, userId, grants: ["issues.archive"] });

// @ts-expect-error vNext requires object args for primary IDs.
void auth.user.get(readCtx, userId);

// @ts-expect-error vNext update payloads live under `{ id, patch }`.
void auth.user.update(userUpdateCtx, userId, { name: "Alice" });

// @ts-expect-error vNext API key verification takes `{ secret }`.
void auth.key.verify(keyCtx, secret);

// @ts-expect-error vNext member updates take `{ id, patch }`.
void auth.member.update(memberUpdateCtx, memberId, { roleIds: [] });

// @ts-expect-error event handlers only accept declared nested groups and names.
void authEvents.handlers({ user: { deleted: async () => {} } });

void auth.event.list(eventCtx, {
  // @ts-expect-error public event reads use the functional where builder, not raw objects.
  where: { kind: "user.created" },
  paginationOpts: { numItems: 10, cursor: null },
});

void auth.event.list(eventCtx, {
  where: (q) =>
    // @ts-expect-error raw string event kinds are not accepted by the where builder.
    q.eq("kind", "user.created"),
  paginationOpts: { numItems: 10, cursor: null },
});

void auth.event.list(eventCtx, {
  where: (q) =>
    // @ts-expect-error unsupported event filter fields are rejected by the where builder.
    q.eq("provider", "google"),
  paginationOpts: { numItems: 10, cursor: null },
});

// @ts-expect-error user scopes require auth User IDs, not auth Group IDs.
void authEvents.target.user(authGroupId);

declare const httpRouter: HttpRouter;

// An MCP tool's `scope` is the permission grant union — a declared grant compiles.
auth.request.mcp(httpRouter, {
  read_projects: {
    description: "List projects.",
    scope: "projects.read",
    args: v.object({}),
    handler: async () => ({}),
  },
});

auth.request.mcp(httpRouter, {
  bad: {
    description: "x",
    // @ts-expect-error the deleted `workspace:*` scope vocabulary is not a grant.
    scope: "workspace:read",
    args: v.object({}),
    handler: async () => ({}),
  },
});

auth.request.mcp(httpRouter, {
  typo: {
    description: "x",
    // @ts-expect-error a typo'd grant is rejected by the configured permissions.
    scope: "projects.raed",
    args: v.object({}),
    handler: async () => ({}),
  },
});
