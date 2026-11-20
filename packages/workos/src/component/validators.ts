/**
 * What WorkOS sends, as Convex validators: its objects, tagged by their
 * literal `object`, and its events, tagged by their literal `event`. Field
 * names are WorkOS's own. Each validator names only the fields this package
 * reads; {@link decode} drops the rest, and turns WorkOS's `null` into an
 * absent optional field.
 *
 * @module
 */
import { type Infer, type Validator, v } from "convex/values";

const vRole = v.object({ slug: v.string() });

/** An organization domain, as `/organization_domains` and its events send it. */
export const vOrganizationDomain = v.object({
  object: v.literal("organization_domain"),
  id: v.string(),
  organization_id: v.string(),
  /** Lowercased in the copy. */
  domain: v.string(),
  state: v.union(
    v.literal("pending"),
    v.literal("verified"),
    v.literal("unverified"),
    v.literal("failed"),
  ),
});
export type OrganizationDomain = Infer<typeof vOrganizationDomain>;

/**
 * A domain as an organization lists it. WorkOS documents the listed entry
 * with less than the domain object: no owner, and not always a state.
 */
const vListedDomain = v.object({
  object: v.literal("organization_domain"),
  id: v.string(),
  domain: v.string(),
  state: v.optional(vOrganizationDomain.fields.state),
});

/** An organization, as `/organizations` and its events send it. */
export const vOrganizationPayload = v.object({
  object: v.literal("organization"),
  id: v.string(),
  name: v.string(),
  external_id: v.optional(v.string()),
  domains: v.array(vListedDomain),
});

/** An organization as the copy keeps it; its domains are their own rows. */
export const vOrganization = vOrganizationPayload.omit("domains");
export type Organization = Infer<typeof vOrganization>;

export const vConnection = v.object({
  object: v.literal("connection"),
  id: v.string(),
  organization_id: v.optional(v.string()),
  name: v.string(),
  /** e.g. `"OktaSAML"`. */
  connection_type: v.string(),
  state: v.union(
    v.literal("requires_type"),
    v.literal("draft"),
    v.literal("active"),
    v.literal("validating"),
    v.literal("inactive"),
    v.literal("deleting"),
  ),
});
export type Connection = Infer<typeof vConnection>;

export const vDirectory = v.object({
  object: v.literal("directory"),
  id: v.string(),
  organization_id: v.optional(v.string()),
  name: v.string(),
  /** e.g. `"okta scim v2.0"`. */
  type: v.string(),
  /**
   * `/directories` says `linked` and `unlinked` where the `dsync.*` events
   * say `active` and `inactive`.
   */
  state: v.union(
    v.literal("linked"),
    v.literal("unlinked"),
    v.literal("active"),
    v.literal("inactive"),
    v.literal("validating"),
    v.literal("invalid_credentials"),
    v.literal("deleting"),
  ),
});
export type Directory = Infer<typeof vDirectory>;

export const vDirectoryUser = v.object({
  object: v.literal("directory_user"),
  id: v.string(),
  directory_id: v.string(),
  organization_id: v.optional(v.string()),
  /** The user's id at the identity provider, the same `idp_id` SSO returns. */
  idp_id: v.string(),
  /** Lowercased in the copy. */
  email: v.optional(v.string()),
  first_name: v.optional(v.string()),
  last_name: v.optional(v.string()),
  /** `inactive` once the directory deprovisioned the user. */
  state: v.union(
    v.literal("active"),
    v.literal("suspended"),
    v.literal("inactive"),
  ),
  role: v.optional(vRole),
  roles: v.optional(v.array(vRole)),
});
export type DirectoryUser = Infer<typeof vDirectoryUser>;

export const vDirectoryGroup = v.object({
  object: v.literal("directory_group"),
  id: v.string(),
  directory_id: v.string(),
  organization_id: v.optional(v.string()),
  idp_id: v.string(),
  name: v.string(),
});
export type DirectoryGroup = Infer<typeof vDirectoryGroup>;

/** An object the copy keeps, tagged by WorkOS's `object`. */
export const vObject = v.union(
  vOrganization,
  vOrganizationDomain,
  vConnection,
  vDirectory,
  vDirectoryUser,
  vDirectoryGroup,
);
export type WorkosObject = Infer<typeof vObject>;

/**
 * The SSO profile `/sso/profile` returns, and the account profile of the
 * `workos` method. The customer's identity provider asserts the email;
 * WorkOS does not verify it. Trust it for account linking only when its
 * domain is one the organization verified.
 */
export const vProfile = v.object({
  object: v.literal("profile"),
  /** WorkOS's profile id, stable for a user of one connection. */
  id: v.string(),
  idp_id: v.string(),
  organization_id: v.optional(v.string()),
  connection_id: v.string(),
  connection_type: v.string(),
  email: v.string(),
  first_name: v.optional(v.string()),
  last_name: v.optional(v.string()),
});
export type Profile = Infer<typeof vProfile>;

const vMembership = v.object({
  directory_id: v.string(),
  user: vDirectoryUser,
  group: vDirectoryGroup,
});

const vVerificationFailure = v.object({
  reason: v.string(),
  organization_domain: vOrganizationDomain,
});

function event<
  const Name extends string,
  Data extends Validator<unknown, "required", string>,
>(name: Name, data: Data) {
  return v.object({
    /**
     * WorkOS's event id. A change the copy makes by itself has none: an
     * object listed while the copy fills, or the users and groups of a
     * deleted directory.
     */
    id: v.optional(v.string()),
    event: v.literal(name),
    data,
  });
}

/** Every event the copy applies, one member per name. */
export const vWorkosEvent = v.union(
  event("organization.created", vOrganizationPayload),
  event("organization.updated", vOrganizationPayload),
  event("organization.deleted", vOrganizationPayload),
  event("organization_domain.created", vOrganizationDomain),
  event("organization_domain.updated", vOrganizationDomain),
  event("organization_domain.verified", vOrganizationDomain),
  event("organization_domain.verification_failed", vVerificationFailure),
  event("organization_domain.deleted", vOrganizationDomain),
  event("connection.activated", vConnection),
  event("connection.deactivated", vConnection),
  event("connection.deleted", vConnection),
  event("dsync.activated", vDirectory),
  event("dsync.deleted", vDirectory),
  event("dsync.user.created", vDirectoryUser),
  event("dsync.user.updated", vDirectoryUser),
  event("dsync.user.deleted", vDirectoryUser),
  event("dsync.group.created", vDirectoryGroup),
  event("dsync.group.updated", vDirectoryGroup),
  event("dsync.group.deleted", vDirectoryGroup),
  event("dsync.group.user_added", vMembership),
  event("dsync.group.user_removed", vMembership),
);
export type WorkosEvent = Infer<typeof vWorkosEvent>;

/** Each event's name, with the object it carries. */
export type WorkosEvents = {
  [Each in WorkosEvent as Each["event"]]: Each["data"];
};

/** The names of {@link vWorkosEvent}, which the copy asks WorkOS for. */
export const EVENTS: readonly WorkosEvent["event"][] = vWorkosEvent.members.map(
  (member) => member.fields.event.value,
);

/** One page of a WorkOS list endpoint. */
export function vList<Item extends Validator<unknown, "required", string>>(
  item: Item,
) {
  return v.object({
    object: v.literal("list"),
    data: v.array(item),
    list_metadata: v.object({
      before: v.optional(v.string()),
      after: v.optional(v.string()),
    }),
  });
}

/** What the Admin Portal can be opened to set up. */
export const vIntent = v.union(
  v.literal("sso"),
  v.literal("dsync"),
  v.literal("domain_verification"),
  v.literal("certificate_renewal"),
);
export type Intent = Infer<typeof vIntent>;

/** A webhook endpoint, from `/webhook_endpoints`. */
export const vWebhookEndpoint = v.object({
  object: v.literal("webhook_endpoint"),
  id: v.string(),
  endpoint_url: v.string(),
  secret: v.string(),
  status: v.union(v.literal("enabled"), v.literal("disabled")),
  events: v.array(v.string()),
});
export type WebhookEndpoint = Infer<typeof vWebhookEndpoint>;
