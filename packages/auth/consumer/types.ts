import { definePermissions } from "@estifanos-sh/convex-auth/permissions";
import { client } from "@estifanos-sh/convex-auth/browser";
import { useAuth as useReactAuth } from "@estifanos-sh/convex-auth/react";
import { useConvexAuth as useSvelteAuth } from "@estifanos-sh/convex-auth/svelte";
import { ErrorCode as ClientErrorCode, type ClientOptions } from "@estifanos-sh/convex-auth/client";
import { credentials } from "@estifanos-sh/convex-auth/providers";
import { webauthn } from "@estifanos-sh/convex-auth/providers/webauthn";
// @ts-expect-error createAuth was hard-cut from the vNext public server API.
import { createAuth } from "@estifanos-sh/convex-auth/server";
import { authEnv, authEvents, defineAuth, type AuthEnv } from "@estifanos-sh/convex-auth/server";
import { type ApiFromModules, defineApp, type FunctionArgs, type HttpRouter } from "convex/server";
import { v, type GenericId, type Infer } from "convex/values";

import { api } from "../../../convex/_generated/api";
import { auth } from "../../../convex/auth";

declare const readCtx: Parameters<typeof auth.user.get>[0];
declare const eventCtx: Parameters<typeof auth.event.list>[0];
declare const memberCreateCtx: Parameters<typeof auth.member.create>[0];
declare const memberRequireCtx: Parameters<typeof auth.member.assert>[0];
declare const userUpdateCtx: Parameters<typeof auth.user.update>[0];
declare const memberUpdateCtx: Parameters<typeof auth.member.update>[0];
declare const keyCtx: Parameters<typeof auth.key.verify>[0];
declare const userId: GenericId<"User">;
declare const groupId: GenericId<"Group">;
declare const memberId: GenericId<"GroupMember">;
declare const keyId: GenericId<"ApiKey">;
declare const secret: string;
declare const authEnvironment: AuthEnv;

const optionalKeyring: string | undefined = authEnvironment.AUTH_KEYS;
// @ts-expect-error Legacy signing material is no longer part of the public environment contract.
void authEnvironment.JWT_PRIVATE_KEY;
// @ts-expect-error Legacy JWKS material is no longer part of the public environment contract.
void authEnvironment.JWKS;
// @ts-expect-error Legacy secret encryption material is no longer public configuration.
void authEnvironment.AUTH_SECRET_ENCRYPTION_KEY;
// @ts-expect-error Provider credentials belong to the application environment.
void authEnvironment.AUTH_GITHUB_ID;
declare const authComponent: Parameters<typeof defineAuth>[0];
declare const authUserId: GenericId<"User">;
declare const authGroupId: GenericId<"Group">;
declare const authConnectionId: GenericId<"GroupConnection">;
declare const authWebhookEndpointId: GenericId<"GroupWebhookEndpoint">;
declare const authReadCtx: Parameters<typeof auth.connection.get>[0];
declare const convex: ClientOptions["convex"];

const authUserIdValidator = auth.v.id("User");
type AuthUserIdFromValidator = Infer<typeof authUserIdValidator>;
type _AuthIdValidatorKeepsTheComponentTable = Assert<
  Equal<AuthUserIdFromValidator, GenericId<"User">>
>;
const validatedAuthUserId: AuthUserIdFromValidator = authUserId;
void validatedAuthUserId;
// @ts-expect-error The public ID validator rejects a different component table.
const wrongAuthUserId: AuthUserIdFromValidator = authGroupId;
void wrongAuthUserId;

const connectionById = auth.connection.get(authReadCtx, { id: authConnectionId });
type ConnectionById = Awaited<typeof connectionById>;
type _ConnectionKeepsExactIds = Assert<
  Equal<NonNullable<ConnectionById>["groupId"], GenericId<"Group">>
>;
void auth.connection.webhook.endpoint.get(authReadCtx, { id: authWebhookEndpointId });
// @ts-expect-error A Group ID cannot select a GroupConnection.
void auth.connection.get(authReadCtx, { id: authGroupId });
// @ts-expect-error A User ID cannot select a webhook endpoint.
void auth.connection.webhook.endpoint.get(authReadCtx, { id: authUserId });

const generatedClient = client({ convex, api: api.auth });

void generatedClient.webauthn.register({ name: "Security key" });
void generatedClient.webauthn.signIn();
void generatedClient.totp.setup();
void generatedClient.device.verify({ code: "ABCD-EFGH" });
void generatedClient.signIn("password", {
  flow: "signIn",
  email: "person@example.com",
  password: "correct horse battery staple",
});
// @ts-expect-error provider IDs come from the configured generated action.
void generatedClient.signIn("invented-provider");
// @ts-expect-error password sign-in requires the password flow parameters.
void generatedClient.signIn("password", { email: "person@example.com" });

type Assert<T extends true> = T;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type ProviderFromArgs<Args> = Args extends unknown
  ? "provider" extends keyof Args
    ? Exclude<Args[keyof Args & "provider"], undefined>
    : never
  : never;
type GeneratedProvider = ProviderFromArgs<FunctionArgs<typeof api.auth.signIn>>;
type _GeneratedProvidersAreExact = Assert<string extends GeneratedProvider ? false : true>;
type GeneratedPasswordArgs = Extract<
  FunctionArgs<typeof api.auth.signIn>,
  { provider: "password" }
>;
const generatedPasswordArgs: GeneratedPasswordArgs = {
  provider: "password",
  params: {
    flow: "signIn",
    email: "person@example.com",
    password: "correct horse battery staple",
  },
};
void generatedPasswordArgs;
// @ts-expect-error Raw WebAuthn ceremonies belong to `generatedClient.webauthn`.
void generatedClient.signIn("webauthn", {});
type _PasskeyClientWasRemoved = Assert<
  "passkey" extends keyof typeof generatedClient ? false : true
>;

const accessProvider = credentials({
  id: "access",
  params: v.object({ email: v.string(), pin: v.string() }),
  authorize: async ({ email, pin }) => {
    void email;
    void pin;
    return null;
  },
});
const optionalProvider = credentials({
  id: "optional",
  params: v.optional(v.object({ redirectTo: v.optional(v.string()) })),
  authorize: async () => null,
});
type OptionalAuthorizeParams = Parameters<typeof optionalProvider.authorize>[0];
type _OptionalAuthorizeReceivesUndefined = Assert<
  Equal<OptionalAuthorizeParams, { redirectTo?: string } | undefined>
>;
const optionalAuth = defineAuth(authComponent, { providers: [optionalProvider] });
type OptionalApi = ApiFromModules<{
  auth: { signIn: typeof optionalAuth.signIn; signOut: typeof optionalAuth.signOut };
}>["auth"];
declare const optionalApi: OptionalApi;
const optionalClient = client({ convex, api: optionalApi });
void optionalClient.signIn("optional");
void optionalClient.signIn("optional", { redirectTo: "/welcome" });
// @ts-expect-error optional provider parameters still use their validator shape.
void optionalClient.signIn("optional", { redirectTo: 1234 });

const accessProviderId: "access" = accessProvider.id;
void accessProviderId;
type AccessAuthorizeParams = Parameters<typeof accessProvider.authorize>[0];
type _AccessAuthorizeUsesValidatorShape = Assert<
  Equal<AccessAuthorizeParams, { email: string; pin: string }>
>;
const accessAuth = defineAuth(authComponent, { providers: [accessProvider] });
type AccessApi = ApiFromModules<{
  auth: { signIn: typeof accessAuth.signIn; signOut: typeof accessAuth.signOut };
}>["auth"];
type AccessProvider = ProviderFromArgs<FunctionArgs<AccessApi["signIn"]>>;
type _AccessProviderIsExact = Assert<string extends AccessProvider ? false : true>;
declare const accessApi: AccessApi;
const accessClient = client({ convex, api: accessApi });
void accessClient.signIn("access", { email: "person@example.com", pin: "1234" });
// @ts-expect-error required validator parameters cannot be omitted.
void accessClient.signIn("access");
// @ts-expect-error validator-derived fields retain their exact types.
void accessClient.signIn("access", { email: "person@example.com", pin: 1234 });
// @ts-expect-error only the configured custom provider is accepted.
void accessClient.signIn("password", {
  flow: "signIn",
  email: "person@example.com",
  password: "secret",
});

void useReactAuth(accessClient);
void accessClient.signIn("access", {
  email: "person@example.com",
  // @ts-expect-error React bindings retain custom provider fields.
  pin: 1234,
});

const extendedAuth = defineAuth(authComponent, {
  providers: [accessProvider],
  extend: {
    User: v.object({ plan: v.literal("pro") }),
    Group: v.object({ billingAccount: v.string() }),
    GroupMember: v.object({ title: v.string() }),
  },
});
const extendedUser = extendedAuth.user.get(readCtx, { id: authUserId });
const extendedGroup = extendedAuth.group.get(readCtx, { id: authGroupId });
const extendedMember = extendedAuth.member.get(readCtx, {
  userId: authUserId,
  groupId: authGroupId,
});
// @ts-expect-error public user lookups only accept auth User IDs.
void extendedAuth.user.get(readCtx, { id: authGroupId });
// @ts-expect-error membership user and group positions remain table-specific.
void extendedAuth.member.get(readCtx, { userId: authGroupId, groupId: authGroupId });
// @ts-expect-error API-key operations only accept auth ApiKey IDs.
void extendedAuth.key.get(readCtx, { id: authUserId });
type ExtendedUser = NonNullable<Awaited<typeof extendedUser>>;
type ExtendedGroup = NonNullable<Awaited<typeof extendedGroup>>;
type ExtendedMember = NonNullable<Awaited<typeof extendedMember>["membership"]>;
type _UserExtensionFlowsThroughReads = Assert<
  Equal<ExtendedUser["extend"], { plan: "pro" } | undefined>
>;
type _GroupExtensionFlowsThroughReads = Assert<
  Equal<ExtendedGroup["extend"], { billingAccount: string } | undefined>
>;
type _MemberExtensionFlowsThroughReads = Assert<
  Equal<ExtendedMember["extend"], { title: string } | undefined>
>;
type _AuthUserIdIsComponentSpecific = Assert<Equal<ExtendedUser["_id"], GenericId<"User">>>;
type _AuthGroupIdIsComponentSpecific = Assert<Equal<ExtendedGroup["_id"], GenericId<"Group">>>;
type _AuthMemberIdIsComponentSpecific = Assert<
  Equal<ExtendedMember["_id"], GenericId<"GroupMember">>
>;
void defineAuth(authComponent, {
  providers: [],
  connection: {
    hooks: {
      afterProvision: async ({ userId }) => {
        userId satisfies GenericId<"User">;
      },
    },
  },
});
const typedClientFailure: Awaited<ReturnType<typeof accessClient.signIn>> = {
  kind: "failed",
  code: ClientErrorCode.INVALID_CREDENTIALS,
};
void typedClientFailure;
void extendedUser;
void extendedGroup;
void extendedMember;
// @ts-expect-error Client typing retains the configured provider union.
void accessClient.signIn("password", {
  flow: "signIn",
  email: "person@example.com",
  password: "secret",
});

const svelteBoundAuth = useSvelteAuth(accessClient);
void svelteBoundAuth.signIn("access", { email: "person@example.com", pin: "1234" });
// @ts-expect-error Svelte bindings retain custom provider fields.
void svelteBoundAuth.signIn("access", { email: "person@example.com", pin: 1234 });
// @ts-expect-error Svelte bindings retain the configured provider union.
void svelteBoundAuth.client.signIn("password", {
  flow: "signIn",
  email: "person@example.com",
  password: "secret",
});

const readonlyOrigins = ["https://app.example.com"] as const;
const readonlyWebAuthnHints = ["security-key"] as const;
const readonlyWebAuthnAlgorithms = [-7, -257] as const;
void webauthn({
  securityKeysOnly: true,
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
void optionalKeyring;
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
// @ts-expect-error user deletion is always a complete auth-owned cascade.
void auth.user.remove(userUpdateCtx, { id: userId, cascade: false });
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

void auth.provider.signIn;
void auth.event.emit;
void auth.factor.list;
void auth.factor.update;
void auth.factor.remove;
void auth.group.active.reset;
void auth.request.routes();

// @ts-expect-error route-table internals are replaced by stable descriptors.
void auth.request.router;

// @ts-expect-error credential primitives are provider-callback internals.
void auth.account.create;

// @ts-expect-error account linking must complete through a verified provider ceremony.
void auth.account.link;

// @ts-expect-error raw TOTP documents include credential material.
void auth.account.totp;

// @ts-expect-error authorization-code consumption is owned by the token endpoint.
void auth.oauth.code;

// @ts-expect-error refresh-token minting and exchange are wire-protocol internals.
void auth.oauth.refresh;

// @ts-expect-error client-secret verification is owned by the token endpoint.
void auth.oauth.client.verify;

// @ts-expect-error registration-token verification is owned by RFC 7592 endpoints.
void auth.oauth.client.verifyRegistrationToken;

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
