/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    connections: {
      get: FunctionReference<
        "query",
        "internal",
        { id: string },
        null | {
          connection_type: string;
          id: string;
          name: string;
          object: "connection";
          organization_id?: string;
          state:
            | "requires_type"
            | "draft"
            | "active"
            | "validating"
            | "inactive"
            | "deleting";
        },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        { organizationId: string },
        Array<{
          connection_type: string;
          id: string;
          name: string;
          object: "connection";
          organization_id?: string;
          state:
            | "requires_type"
            | "draft"
            | "active"
            | "validating"
            | "inactive"
            | "deleting";
        }>,
        Name
      >;
    };
    directories: {
      get: FunctionReference<
        "query",
        "internal",
        { id: string },
        null | {
          id: string;
          name: string;
          object: "directory";
          organization_id?: string;
          state:
            | "linked"
            | "unlinked"
            | "active"
            | "inactive"
            | "validating"
            | "invalid_credentials"
            | "deleting";
          type: string;
        },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        { organizationId: string },
        Array<{
          id: string;
          name: string;
          object: "directory";
          organization_id?: string;
          state:
            | "linked"
            | "unlinked"
            | "active"
            | "inactive"
            | "validating"
            | "invalid_credentials"
            | "deleting";
          type: string;
        }>,
        Name
      >;
    };
    directoryGroups: {
      get: FunctionReference<
        "query",
        "internal",
        { id: string },
        null | {
          directory_id: string;
          id: string;
          idp_id: string;
          name: string;
          object: "directory_group";
          organization_id?: string;
        },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          filter: { directory: string } | { organization: string };
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            directory_id: string;
            id: string;
            idp_id: string;
            name: string;
            object: "directory_group";
            organization_id?: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
    };
    directoryUsers: {
      get: FunctionReference<
        "query",
        "internal",
        { id: string },
        null | {
          directory_id: string;
          email?: string;
          first_name?: string;
          id: string;
          idp_id: string;
          last_name?: string;
          object: "directory_user";
          organization_id?: string;
          role?: { slug: string };
          roles?: Array<{ slug: string }>;
          state: "active" | "suspended" | "inactive";
        },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          filter:
            | { directory: string }
            | { idpId?: string; organization: string }
            | { idpId: string }
            | { email: string };
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            directory_id: string;
            email?: string;
            first_name?: string;
            id: string;
            idp_id: string;
            last_name?: string;
            object: "directory_user";
            organization_id?: string;
            role?: { slug: string };
            roles?: Array<{ slug: string }>;
            state: "active" | "suspended" | "inactive";
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
    };
    events: {
      land: FunctionReference<
        "mutation",
        "internal",
        { until: string },
        | {
            changes: Array<
              | {
                  data: {
                    domains: Array<{
                      domain: string;
                      id: string;
                      object: "organization_domain";
                      state?: "pending" | "verified" | "unverified" | "failed";
                    }>;
                    external_id?: string;
                    id: string;
                    name: string;
                    object: "organization";
                  };
                  event: "organization.created";
                  id?: string;
                }
              | {
                  data: {
                    domains: Array<{
                      domain: string;
                      id: string;
                      object: "organization_domain";
                      state?: "pending" | "verified" | "unverified" | "failed";
                    }>;
                    external_id?: string;
                    id: string;
                    name: string;
                    object: "organization";
                  };
                  event: "organization.updated";
                  id?: string;
                }
              | {
                  data: {
                    domains: Array<{
                      domain: string;
                      id: string;
                      object: "organization_domain";
                      state?: "pending" | "verified" | "unverified" | "failed";
                    }>;
                    external_id?: string;
                    id: string;
                    name: string;
                    object: "organization";
                  };
                  event: "organization.deleted";
                  id?: string;
                }
              | {
                  data: {
                    domain: string;
                    id: string;
                    object: "organization_domain";
                    organization_id: string;
                    state: "pending" | "verified" | "unverified" | "failed";
                  };
                  event: "organization_domain.created";
                  id?: string;
                }
              | {
                  data: {
                    domain: string;
                    id: string;
                    object: "organization_domain";
                    organization_id: string;
                    state: "pending" | "verified" | "unverified" | "failed";
                  };
                  event: "organization_domain.updated";
                  id?: string;
                }
              | {
                  data: {
                    domain: string;
                    id: string;
                    object: "organization_domain";
                    organization_id: string;
                    state: "pending" | "verified" | "unverified" | "failed";
                  };
                  event: "organization_domain.verified";
                  id?: string;
                }
              | {
                  data: {
                    organization_domain: {
                      domain: string;
                      id: string;
                      object: "organization_domain";
                      organization_id: string;
                      state: "pending" | "verified" | "unverified" | "failed";
                    };
                    reason: string;
                  };
                  event: "organization_domain.verification_failed";
                  id?: string;
                }
              | {
                  data: {
                    domain: string;
                    id: string;
                    object: "organization_domain";
                    organization_id: string;
                    state: "pending" | "verified" | "unverified" | "failed";
                  };
                  event: "organization_domain.deleted";
                  id?: string;
                }
              | {
                  data: {
                    connection_type: string;
                    id: string;
                    name: string;
                    object: "connection";
                    organization_id?: string;
                    state:
                      | "requires_type"
                      | "draft"
                      | "active"
                      | "validating"
                      | "inactive"
                      | "deleting";
                  };
                  event: "connection.activated";
                  id?: string;
                }
              | {
                  data: {
                    connection_type: string;
                    id: string;
                    name: string;
                    object: "connection";
                    organization_id?: string;
                    state:
                      | "requires_type"
                      | "draft"
                      | "active"
                      | "validating"
                      | "inactive"
                      | "deleting";
                  };
                  event: "connection.deactivated";
                  id?: string;
                }
              | {
                  data: {
                    connection_type: string;
                    id: string;
                    name: string;
                    object: "connection";
                    organization_id?: string;
                    state:
                      | "requires_type"
                      | "draft"
                      | "active"
                      | "validating"
                      | "inactive"
                      | "deleting";
                  };
                  event: "connection.deleted";
                  id?: string;
                }
              | {
                  data: {
                    id: string;
                    name: string;
                    object: "directory";
                    organization_id?: string;
                    state:
                      | "linked"
                      | "unlinked"
                      | "active"
                      | "inactive"
                      | "validating"
                      | "invalid_credentials"
                      | "deleting";
                    type: string;
                  };
                  event: "dsync.activated";
                  id?: string;
                }
              | {
                  data: {
                    id: string;
                    name: string;
                    object: "directory";
                    organization_id?: string;
                    state:
                      | "linked"
                      | "unlinked"
                      | "active"
                      | "inactive"
                      | "validating"
                      | "invalid_credentials"
                      | "deleting";
                    type: string;
                  };
                  event: "dsync.deleted";
                  id?: string;
                }
              | {
                  data: {
                    directory_id: string;
                    email?: string;
                    first_name?: string;
                    id: string;
                    idp_id: string;
                    last_name?: string;
                    object: "directory_user";
                    organization_id?: string;
                    role?: { slug: string };
                    roles?: Array<{ slug: string }>;
                    state: "active" | "suspended" | "inactive";
                  };
                  event: "dsync.user.created";
                  id?: string;
                }
              | {
                  data: {
                    directory_id: string;
                    email?: string;
                    first_name?: string;
                    id: string;
                    idp_id: string;
                    last_name?: string;
                    object: "directory_user";
                    organization_id?: string;
                    role?: { slug: string };
                    roles?: Array<{ slug: string }>;
                    state: "active" | "suspended" | "inactive";
                  };
                  event: "dsync.user.updated";
                  id?: string;
                }
              | {
                  data: {
                    directory_id: string;
                    email?: string;
                    first_name?: string;
                    id: string;
                    idp_id: string;
                    last_name?: string;
                    object: "directory_user";
                    organization_id?: string;
                    role?: { slug: string };
                    roles?: Array<{ slug: string }>;
                    state: "active" | "suspended" | "inactive";
                  };
                  event: "dsync.user.deleted";
                  id?: string;
                }
              | {
                  data: {
                    directory_id: string;
                    id: string;
                    idp_id: string;
                    name: string;
                    object: "directory_group";
                    organization_id?: string;
                  };
                  event: "dsync.group.created";
                  id?: string;
                }
              | {
                  data: {
                    directory_id: string;
                    id: string;
                    idp_id: string;
                    name: string;
                    object: "directory_group";
                    organization_id?: string;
                  };
                  event: "dsync.group.updated";
                  id?: string;
                }
              | {
                  data: {
                    directory_id: string;
                    id: string;
                    idp_id: string;
                    name: string;
                    object: "directory_group";
                    organization_id?: string;
                  };
                  event: "dsync.group.deleted";
                  id?: string;
                }
              | {
                  data: {
                    directory_id: string;
                    group: {
                      directory_id: string;
                      id: string;
                      idp_id: string;
                      name: string;
                      object: "directory_group";
                      organization_id?: string;
                    };
                    user: {
                      directory_id: string;
                      email?: string;
                      first_name?: string;
                      id: string;
                      idp_id: string;
                      last_name?: string;
                      object: "directory_user";
                      organization_id?: string;
                      role?: { slug: string };
                      roles?: Array<{ slug: string }>;
                      state: "active" | "suspended" | "inactive";
                    };
                  };
                  event: "dsync.group.user_added";
                  id?: string;
                }
              | {
                  data: {
                    directory_id: string;
                    group: {
                      directory_id: string;
                      id: string;
                      idp_id: string;
                      name: string;
                      object: "directory_group";
                      organization_id?: string;
                    };
                    user: {
                      directory_id: string;
                      email?: string;
                      first_name?: string;
                      id: string;
                      idp_id: string;
                      last_name?: string;
                      object: "directory_user";
                      organization_id?: string;
                      role?: { slug: string };
                      roles?: Array<{ slug: string }>;
                      state: "active" | "suspended" | "inactive";
                    };
                  };
                  event: "dsync.group.user_removed";
                  id?: string;
                }
            >;
            landed: true;
          }
        | { landed: false },
        Name
      >;
      pull: FunctionReference<
        "action",
        "internal",
        {},
        null | { after: null | string; until: string },
        Name
      >;
      reset: FunctionReference<
        "mutation",
        "internal",
        {},
        { done: boolean },
        Name
      >;
    };
    organizationDomains: {
      get: FunctionReference<
        "query",
        "internal",
        { domain: string },
        null | {
          connection: {
            connection_type: string;
            id: string;
            name: string;
            object: "connection";
            organization_id?: string;
            state:
              | "requires_type"
              | "draft"
              | "active"
              | "validating"
              | "inactive"
              | "deleting";
          };
          organization: {
            external_id?: string;
            id: string;
            name: string;
            object: "organization";
          };
        },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        { organizationId: string },
        Array<{
          domain: string;
          id: string;
          object: "organization_domain";
          organization_id: string;
          state: "pending" | "verified" | "unverified" | "failed";
        }>,
        Name
      >;
    };
    organizations: {
      get: FunctionReference<
        "query",
        "internal",
        { by: { id: string } | { externalId: string } },
        null | {
          external_id?: string;
          id: string;
          name: string;
          object: "organization";
        },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            external_id?: string;
            id: string;
            name: string;
            object: "organization";
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
    };
    portal: {
      link: FunctionReference<
        "action",
        "internal",
        {
          intent:
            "sso" | "dsync" | "domain_verification" | "certificate_renewal";
          organizationId: string;
          returnUrl?: string;
          successUrl?: string;
        },
        string,
        Name
      >;
    };
    provider: {
      _internal_dangerous_createAccount: FunctionReference<
        "mutation",
        "internal",
        { providerAccountId: string; userId: string },
        null,
        Name
      >;
      _internal_dangerous_createAuthorizationRequest: FunctionReference<
        "mutation",
        "internal",
        {
          callbackUrl?: string;
          codeVerifier: string;
          redirectTo: string;
          stateHash: string;
        },
        { callbackUrl: string; clientId: string },
        Name
      >;
      _internal_dangerous_deferTicket: FunctionReference<
        "mutation",
        "internal",
        { encryptedPayload: string; ticketCodeHash: string },
        null,
        Name
      >;
      claimTicket: FunctionReference<
        "mutation",
        "internal",
        { stateHash: string; ticketCodeHash: string },
        null | { encryptedPayload: string },
        Name
      >;
      deferredTicket: FunctionReference<
        "query",
        "internal",
        { ticketCodeHash: string },
        null | { encryptedPayload: string },
        Name
      >;
      getUserIdByAccount: FunctionReference<
        "query",
        "internal",
        { providerAccountId: string },
        string | null,
        Name
      >;
    };
  };
