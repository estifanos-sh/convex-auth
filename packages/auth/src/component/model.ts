import { paginationResultValidator } from "convex/server";
import {
  type GenericId,
  type Infer,
  v,
  type Validator,
  type VId,
  type VLiteral,
} from "convex/values";

import { AUTH_EVENT_KINDS, EVENT_CATEGORIES } from "../shared/event/kinds";

/**
 * Build a `v.union` of string-literal validators from a non-empty tuple,
 * preserving each literal in the inferred type (so `Infer<>` stays the precise
 * union, not `string`). Used to derive the event kind/category validators from
 * the shared taxonomy tuples.
 */
function vLiteralUnion<T extends string>(values: readonly [T, ...T[]]) {
  const literals = values.map((value) => v.literal(value)) as {
    [K in keyof T[]]: VLiteral<T>;
  } & [VLiteral<T>, ...VLiteral<T>[]];
  return v.union(...literals);
}

/**
 * Sort direction accepted by every paginated component list query.
 *
 * Declared once so the seven component list validators and the server-side
 * `order?:` parameters cannot disagree about the accepted directions.
 */
export const vSortOrder = v.union(v.literal("asc"), v.literal("desc"));

/** Sort direction for paginated list queries. @see {@link vSortOrder} */
export type SortOrder = Infer<typeof vSortOrder>;

/** Table-name lookup map for the component's tables. */
export const TABLES = {
  User: "User",
  UserEmail: "UserEmail",
  Session: "Session",
  Account: "Account",
  AuthVerifier: "AuthVerifier",
  AuthContinuation: "AuthContinuation",
  CredentialEnrollment: "CredentialEnrollment",
  PasswordReset: "PasswordReset",
  VerificationCode: "VerificationCode",
  RefreshToken: "RefreshToken",
  Passkey: "Passkey",
  TotpFactor: "TotpFactor",
  Group: "Group",
  GroupMember: "GroupMember",
  GroupInvite: "GroupInvite",
  GroupConnection: "GroupConnection",
  GroupConnectionDomain: "GroupConnectionDomain",
  SamlLoginRequest: "SamlLoginRequest",
  SamlSeenAssertion: "SamlSeenAssertion",
  GroupConnectionDomainVerification: "GroupConnectionDomainVerification",
  GroupConnectionSecret: "GroupConnectionSecret",
  GroupConnectionScimConfig: "GroupConnectionScimConfig",
  GroupConnectionScimIdentity: "GroupConnectionScimIdentity",
  GroupWebhookEndpoint: "GroupWebhookEndpoint",
  GroupWebhookDelivery: "GroupWebhookDelivery",
  ApiKey: "ApiKey",
  DeviceCode: "DeviceCode",
  OAuthClient: "OAuthClient",
  OAuthCode: "OAuthCode",
  OAuthRefreshGrant: "OAuthRefreshGrant",
  OAuthRefreshToken: "OAuthRefreshToken",
  AuthEventProjection: "AuthEventProjection",
} as const;

/**
 * Convex-native pagination return shape — matches `PaginationResult<T>` from
 * `convex/server`. Consumers can pass these queries directly to
 * `usePaginatedQuery` without any client-side adaptation.
 */
export const vPaginated = <V extends Validator<any, any, any>>(item: V) =>
  paginationResultValidator(item);

/** Lifecycle status of a group invite. */
export const vInviteStatus = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("revoked"),
  v.literal("expired"),
);

/** Authorization status of an OAuth device-code flow. */
export const vDeviceStatus = v.union(
  v.literal("pending"),
  v.literal("authorized"),
  v.literal("denied"),
);

/**
 * How an OAuth client authenticates at the token endpoint (RFC 7591 §2). A
 * `none` client is public (no secret; PKCE is the proof); the others are
 * confidential and present a `client_secret`.
 */
export const vTokenEndpointAuthMethod = v.union(
  v.literal("client_secret_basic"),
  v.literal("client_secret_post"),
  v.literal("none"),
);

/** Policy for linking an incoming connection login to an existing account. */
export const vGroupConnectionAccountLinkingPolicy = v.union(
  v.literal("verifiedEmail"),
  v.literal("none"),
  v.literal("sameConnection"),
);

const vGroupConnectionJitProvisioningMode = v.union(
  v.literal("off"),
  v.literal("createUser"),
  v.literal("createUserAndMembership"),
);

/** How SCIM deprovisioning removes an identity: soft-disable or hard-delete. */
export const vGroupConnectionDeprovisionMode = v.union(v.literal("soft"), v.literal("hard"));

/** When to refresh a user's profile fields from connection data on login. */
export const vGroupConnectionProfileUpdateMode = v.union(
  v.literal("never"),
  v.literal("missing"),
  v.literal("always"),
);

const vGroupConnectionProvisioningAuthority = v.union(v.literal("app"), v.literal("scim"));

const vGroupConnectionGroupSyncMode = v.union(v.literal("ignore"), v.literal("sync"));

const vGroupConnectionRoleSyncMode = v.union(v.literal("ignore"), v.literal("map"));

/** Lifecycle status of a group SSO connection. */
export const vGroupConnectionStatus = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("disabled"),
);

/**
 * Lifecycle status of a group SSO connection, derived from
 * {@link vGroupConnectionStatus} so the TS union and the runtime validator
 * cannot drift. Re-exported from `server/types.ts` for server-side consumers.
 */
export type ConnectionStatus = Infer<typeof vGroupConnectionStatus>;

/** SSO protocol used by a group connection. */
export const vGroupConnectionProtocol = v.union(v.literal("oidc"), v.literal("saml"));

/**
 * SSO protocol used by a group connection, derived from
 * {@link vGroupConnectionProtocol}. Re-exported from `server/types.ts`.
 */
export type ConnectionProtocol = Infer<typeof vGroupConnectionProtocol>;

/** Identity-linking and provisioning policy for a group connection. */
export const vGroupConnectionPolicy = v.object({
  version: v.literal(1),
  identity: v.object({
    accountLinking: v.object({
      oidc: vGroupConnectionAccountLinkingPolicy,
      saml: vGroupConnectionAccountLinkingPolicy,
    }),
  }),
  provisioning: v.object({
    user: v.object({
      createOnSignIn: v.boolean(),
      updateProfileOnLogin: vGroupConnectionProfileUpdateMode,
      updateProfileFromScim: vGroupConnectionProfileUpdateMode,
      authority: vGroupConnectionProvisioningAuthority,
    }),
    jit: v.object({
      mode: vGroupConnectionJitProvisioningMode,
      defaultRole: v.optional(v.string()),
      defaultRoleIds: v.optional(v.array(v.string())),
    }),
    deprovision: v.object({
      mode: vGroupConnectionDeprovisionMode,
    }),
    groups: v.object({
      mode: vGroupConnectionGroupSyncMode,
      source: v.literal("protocol"),
      mapping: v.optional(v.record(v.string(), v.array(v.string()))),
    }),
    roles: v.object({
      mode: vGroupConnectionRoleSyncMode,
      source: v.literal("protocol"),
      mapping: v.optional(v.record(v.string(), v.array(v.string()))),
    }),
  }),
  extend: v.optional(v.any()),
});

/** Lifecycle status of a SCIM provisioning configuration. */
export const vScimStatus = v.union(v.literal("draft"), v.literal("active"), v.literal("disabled"));

/** Lifecycle status of a SCIM provisioning configuration. @see {@link vScimStatus} */
export type ScimStatus = Infer<typeof vScimStatus>;

/** SCIM resource type being provisioned. */
export const vScimResourceType = v.union(v.literal("user"), v.literal("group"));

/** Whether a webhook endpoint is accepting deliveries. */
export const vWebhookEndpointStatus = v.union(v.literal("active"), v.literal("disabled"));

/** Whether a webhook endpoint is accepting deliveries. @see {@link vWebhookEndpointStatus} */
export type WebhookEndpointStatus = Infer<typeof vWebhookEndpointStatus>;

/** Delivery state of a queued webhook event. */
export const vWebhookDeliveryStatus = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("delivered"),
  v.literal("failed"),
);

/** Kind of entity an auth event is indexed against. */
export const vAuthEventTargetKind = v.union(
  v.literal("user"),
  v.literal("session"),
  v.literal("group"),
  v.literal("connection"),
  v.literal("oauth_client"),
  v.literal("api_key"),
  v.literal("global"),
);

/**
 * High-level category grouping for an auth event. Derived from the shared
 * {@link EVENT_CATEGORIES} taxonomy so the validator and the `AuthEventCategory`
 * TS union stay in lockstep.
 */
export const vAuthEventCategory = vLiteralUnion(EVENT_CATEGORIES);

/**
 * Discriminator naming the specific auth event that occurred. Derived from the
 * shared {@link AUTH_EVENT_KINDS} taxonomy — the single source of truth for the
 * event kind set shared with the server facade.
 */
export const vAuthEventKind = vLiteralUnion(AUTH_EVENT_KINDS);

/** Type of principal that triggered an auth event. */
export const vAuthEventActorType = v.union(
  v.literal("user"),
  v.literal("system"),
  v.literal("scim"),
  v.literal("api_key"),
  v.literal("oauth_client"),
  v.literal("webhook"),
  v.literal("anonymous"),
);

/** Type of entity an auth event acted upon. */
export const vAuthEventSubjectType = v.union(
  v.literal("user"),
  v.literal("session"),
  v.literal("account"),
  v.literal("passkey"),
  v.literal("totp"),
  v.literal("email"),
  v.literal("phone"),
  v.literal("api_key"),
  v.literal("oauth_client"),
  v.literal("oauth_code"),
  v.literal("group"),
  v.literal("connection"),
  v.literal("scim_identity"),
  v.literal("webhook_endpoint"),
  v.literal("webhook_delivery"),
  v.literal("system"),
);

/** Whether the action behind an auth event succeeded or failed. */
export const vAuthEventOutcome = v.union(v.literal("success"), v.literal("failure"));

const vAuthEventStringArray = v.array(v.string());
const vAuthExternalObject = v.record(v.string(), v.any());

/** Discriminated union of per-kind auth-event payload shapes. */
export const vAuthEventData = v.union(
  v.object({
    type: v.optional(v.string()),
    provider: v.optional(v.string()),
    profile: v.optional(vAuthExternalObject),
    existingUserId: v.optional(v.string()),
  }),
  v.object({
    provider: v.string(),
    method: v.optional(v.string()),
  }),
  v.object({
    userId: v.optional(v.string()),
    reason: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    refreshTokenId: v.optional(v.string()),
    flow: v.optional(v.union(v.literal("reset"), v.literal("change"))),
  }),
  v.object({
    provider: v.optional(v.string()),
    providerAccountId: v.optional(v.string()),
    accountId: v.optional(v.string()),
  }),
  v.object({
    passkeyId: v.optional(v.string()),
    credentialId: v.optional(v.string()),
    totpId: v.optional(v.string()),
    keyId: v.optional(v.string()),
    name: v.optional(v.string()),
    prefix: v.optional(v.string()),
    reason: v.optional(v.string()),
  }),
  v.object({
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    userId: v.optional(v.string()),
  }),
  v.object({
    clientId: v.optional(v.string()),
    codeId: v.optional(v.string()),
    name: v.optional(v.string()),
    scopes: v.optional(vAuthEventStringArray),
    redirectUri: v.optional(v.string()),
    grantType: v.optional(v.string()),
    resource: v.optional(v.string()),
    userId: v.optional(v.string()),
  }),
  v.object({
    connectionId: v.optional(v.string()),
    changed: v.optional(vAuthEventStringArray),
    userId: v.optional(v.string()),
    protocol: v.optional(vGroupConnectionProtocol),
    domain: v.optional(v.string()),
    recordName: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    verifiedAt: v.optional(v.number()),
    metadataUrl: v.optional(v.string()),
    domains: v.optional(vAuthEventStringArray),
    issuer: v.optional(v.string()),
    discoveryUrl: v.optional(v.string()),
    jwksUri: v.optional(v.string()),
    audience: v.optional(v.union(v.string(), vAuthEventStringArray)),
    tokenEndpointAuthMethod: v.optional(v.string()),
    version: v.optional(v.number()),
    errorCode: v.optional(v.string()),
  }),
  v.object({
    scimConfigId: v.optional(v.string()),
    resourceType: v.optional(vScimResourceType),
    resourceId: v.optional(v.string()),
    operation: v.optional(v.string()),
    externalId: v.optional(v.string()),
    active: v.optional(v.boolean()),
    groupId: v.optional(v.string()),
    userId: v.optional(v.string()),
  }),
  v.object({
    endpointId: v.optional(v.string()),
    deliveryId: v.optional(v.string()),
    sourceEventId: v.optional(v.string()),
    sourceEventType: v.optional(vAuthEventKind),
    attemptCount: v.optional(v.number()),
    status: v.optional(v.number()),
    error: v.optional(v.string()),
  }),
);

/** Entity an auth event is indexed against (kind plus id). */
export const vAuthEventTarget = v.object({
  kind: vAuthEventTargetKind,
  id: v.string(),
});

/** Principal that triggered an auth event (type plus optional id). */
export const vAuthEventActor = v.object({
  type: vAuthEventActorType,
  id: v.optional(v.string()),
});

/** Entity an auth event acted upon (type plus optional id). */
export const vAuthEventSubject = v.object({
  type: vAuthEventSubjectType,
  id: v.optional(v.string()),
});

/** Request metadata captured alongside an auth event. */
export const vAuthEventRequest = v.object({
  requestId: v.optional(v.string()),
  ip: v.optional(v.string()),
  userAgent: v.optional(v.string()),
});

/** A complete auth event as appended to the event log. */
export const vAuthEvent = v.object({
  eventId: v.string(),
  kind: vAuthEventKind,
  category: vAuthEventCategory,
  occurredAt: v.number(),
  actor: vAuthEventActor,
  subject: vAuthEventSubject,
  targets: v.array(vAuthEventTarget),
  request: v.optional(vAuthEventRequest),
  outcome: vAuthEventOutcome,
  errorCode: v.optional(v.string()),
  data: v.optional(vAuthEventData),
});

/**
 * Auth event supplied by a caller. The category is deliberately absent: the
 * component derives it from the canonical event-kind taxonomy before storing
 * projections or appending to the private stream.
 */
export const vAuthEventInput = v.object({
  eventId: v.string(),
  kind: vAuthEventKind,
  occurredAt: v.number(),
  actor: vAuthEventActor,
  subject: vAuthEventSubject,
  targets: v.array(vAuthEventTarget),
  request: v.optional(vAuthEventRequest),
  outcome: vAuthEventOutcome,
  errorCode: v.optional(v.string()),
  data: v.optional(vAuthEventData),
});

/** Filter selector for querying auth-event projections. */
export const vAuthEventWhere = v.object({
  target: v.optional(vAuthEventTarget),
  kind: v.optional(vAuthEventKind),
  category: v.optional(vAuthEventCategory),
  outcome: v.optional(vAuthEventOutcome),
  actor: v.optional(vAuthEventActor),
  subject: v.optional(vAuthEventSubject),
  requestId: v.optional(v.string()),
  occurredAtGte: v.optional(v.number()),
  occurredAtGt: v.optional(v.number()),
  occurredAtLte: v.optional(v.number()),
  occurredAtLt: v.optional(v.number()),
});

const vInviteTokenAcceptStatus = v.union(v.literal("accepted"), v.literal("already_accepted"));

const vMembershipStatus = v.union(
  v.literal("joined"),
  v.literal("already_joined"),
  v.literal("not_applicable"),
);

/** A resource plus the actions an API key is permitted on it. */
export const vApiKeyScope = v.object({
  resource: v.string(),
  actions: v.array(v.string()),
});

/** Rate-limit configuration for an API key (requests per window). */
export const vApiKeyRateLimit = v.object({
  maxRequests: v.number(),
  windowMs: v.number(),
});

/** Mutable rate-limit counters tracked for an API key. */
export const vApiKeyRateLimitState = v.object({
  attemptsLeft: v.number(),
  lastAttemptTime: v.number(),
});

/** Kind of encrypted secret stored for a group connection. */
export const vGroupConnectionSecretKind = v.union(v.literal("oidc_client_secret"));

/**
 * The shape of `v.id` — and any drop-in replacement that needs to type-claim
 * `Id<T>` while choosing a different runtime validator (e.g. `v.string()` for
 * cross-component boundaries where the consumer's data model lacks the
 * component's table tags).
 */
export type IdValidatorFn = <T extends string>(table: T) => VId<GenericId<T>, "required">;

/**
 * Field maps for the five documents that cross the component boundary.
 *
 * Each builder takes the ID validator function as its only parameter and
 * is called twice in the codebase: once with `v.id` here (strict —
 * component-internal `vUserDoc` etc.), and once with `vIdString` over in
 * `server/validators.ts` (permissive — the `auth.v.*` consumer-facing
 * validators that need to accept component-issued IDs after they cross the
 * component boundary).
 *
 * Each builder is generic over the ID-validator function so each call site
 * preserves its concrete return type. Without `<F extends IdValidatorFn>`
 * TypeScript collapses `Infer<…>._id` to a single shared inference.
 */
export const userFields = <F extends IdValidatorFn>(vId: F) => ({
  _id: vId(TABLES.User),
  _creationTime: v.number(),
  name: v.optional(v.string()),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  image: v.optional(v.string()),
  email: v.optional(v.string()),
  emailVerificationTime: v.optional(v.number()),
  phone: v.optional(v.string()),
  phoneVerificationTime: v.optional(v.number()),
  isAnonymous: v.optional(v.boolean()),
  lastActiveGroup: v.optional(vId(TABLES.Group)),
  sessionEpoch: v.number(),
  extend: v.optional(v.any()),
});

/** Shared field validators for `UserEmail` documents, parameterized by the id-validator factory. */
export const emailFields = <F extends IdValidatorFn>(vId: F) => ({
  _id: vId(TABLES.UserEmail),
  _creationTime: v.number(),
  userId: vId(TABLES.User),
  email: v.string(),
  verificationTime: v.optional(v.number()),
  isPrimary: v.boolean(),
  source: vUserEmailSource,
  accountId: v.optional(vId(TABLES.Account)),
  provider: v.optional(v.string()),
  connectionId: v.optional(vId(TABLES.GroupConnection)),
});

/** Shared field validators for `Group` documents, parameterized by the id-validator factory. */
export const groupFields = <F extends IdValidatorFn>(vId: F) => ({
  _id: vId(TABLES.Group),
  _creationTime: v.number(),
  name: v.string(),
  slug: v.optional(v.string()),
  type: v.optional(v.string()),
  parentGroupId: v.optional(vId(TABLES.Group)),
  rootGroupId: v.optional(vId(TABLES.Group)),
  isRoot: v.optional(v.boolean()),
  policy: v.optional(vGroupConnectionPolicy),
  extend: v.optional(v.any()),
});

/** Shared field validators for `GroupMember` documents, parameterized by the id-validator factory. */
export const memberFields = <F extends IdValidatorFn>(vId: F) => ({
  _id: vId(TABLES.GroupMember),
  _creationTime: v.number(),
  groupId: vId(TABLES.Group),
  userId: vId(TABLES.User),
  role: v.optional(v.string()),
  roleIds: v.optional(v.array(v.string())),
  status: v.optional(v.string()),
  extend: v.optional(v.any()),
});

/** Shared field validators for `GroupInvite` documents, parameterized by the id-validator factory. */
export const inviteFields = <F extends IdValidatorFn>(vId: F) => ({
  _id: vId(TABLES.GroupInvite),
  _creationTime: v.number(),
  groupId: v.optional(vId(TABLES.Group)),
  invitedByUserId: v.optional(vId(TABLES.User)),
  email: v.optional(v.string()),
  tokenHash: v.string(),
  role: v.optional(v.string()),
  roleIds: v.optional(v.array(v.string())),
  status: vInviteStatus,
  expiresTime: v.optional(v.number()),
  acceptedByUserId: v.optional(vId(TABLES.User)),
  acceptedTime: v.optional(v.number()),
  extend: v.optional(v.any()),
});

/** Origin that contributed a user's email address. */
export const vUserEmailSource = v.union(
  v.literal("password"),
  v.literal("oauth"),
  v.literal("oidc"),
  v.literal("saml"),
  v.literal("scim"),
);

/** Origin that contributed a user's email address. @see {@link vUserEmailSource} */
export type UserEmailSource = Infer<typeof vUserEmailSource>;

/** An email entry within a provider profile. */
export const vProfileEmail = v.object({
  email: v.string(),
  primary: v.optional(v.boolean()),
  verified: v.optional(v.boolean()),
});

const vPayloadPrimitive = v.union(v.string(), v.number(), v.boolean(), v.null());
const vPayloadArray = v.array(vPayloadPrimitive);
const vPayloadNestedRecord = v.record(v.string(), v.union(vPayloadPrimitive, vPayloadArray));

/** JSON-compatible provider payload record stored at auth boundaries. */
export const vPayloadRecord = v.record(
  v.string(),
  v.union(vPayloadPrimitive, vPayloadArray, vPayloadNestedRecord),
);

/** Validator for the public (redacted) projection of a `GroupWebhookDelivery` document. */
export const vGroupWebhookDeliveryPublicDoc = v.object({
  _id: v.id(TABLES.GroupWebhookDelivery),
  _creationTime: v.number(),
  connectionId: v.id(TABLES.GroupConnection),
  endpointId: v.id(TABLES.GroupWebhookEndpoint),
  eventId: v.string(),
  kind: vAuthEventKind,
  status: vWebhookDeliveryStatus,
  attemptCount: v.number(),
  nextAttemptAt: v.number(),
  lastAttemptAt: v.optional(v.number()),
  lastResponseStatus: v.optional(v.number()),
  lastError: v.optional(v.string()),
  signedAt: v.number(),
});

/** Summary returned after accepting an invite token: the invite plus resulting group/membership state. */
export const vInviteAcceptResult = v.object({
  inviteId: v.id(TABLES.GroupInvite),
  groupId: v.union(v.id(TABLES.Group), v.null()),
  memberId: v.optional(v.id(TABLES.GroupMember)),
  inviteStatus: vInviteTokenAcceptStatus,
  membershipStatus: vMembershipStatus,
});
