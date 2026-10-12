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
    admin: {
      createMembership: FunctionReference<
        "action",
        "internal",
        {
          handles: {
            connection?: string;
            directory?: string;
            directoryGroup?: string;
            directoryMember?: string;
            directoryUser?: string;
            membership?: string;
            organization?: string;
            user?: string;
          };
          organization: string;
          role?: string;
          user: string;
        },
        {
          at: number;
          deleted: boolean;
          organization: string;
          role: string;
          status: "active" | "inactive" | "pending";
          user: string;
          workosId: string;
        },
        Name
      >;
      createOrganization: FunctionReference<
        "action",
        "internal",
        {
          domains?: Array<{ domain: string; state: "pending" | "verified" }>;
          externalId?: string;
          handles: {
            connection?: string;
            directory?: string;
            directoryGroup?: string;
            directoryMember?: string;
            directoryUser?: string;
            membership?: string;
            organization?: string;
            user?: string;
          };
          name: string;
        },
        {
          at: number;
          deleted: boolean;
          externalId?: string;
          name: string;
          workosId: string;
        },
        Name
      >;
      deleteMembership: FunctionReference<
        "action",
        "internal",
        {
          handles: {
            connection?: string;
            directory?: string;
            directoryGroup?: string;
            directoryMember?: string;
            directoryUser?: string;
            membership?: string;
            organization?: string;
            user?: string;
          };
          membership: string;
        },
        null,
        Name
      >;
      fetchMembership: FunctionReference<
        "action",
        "internal",
        { organization: string; user: string },
        null | {
          at: number;
          deleted: boolean;
          organization: string;
          role: string;
          status: "active" | "inactive" | "pending";
          user: string;
          workosId: string;
        },
        Name
      >;
      updateMembership: FunctionReference<
        "action",
        "internal",
        {
          handles: {
            connection?: string;
            directory?: string;
            directoryGroup?: string;
            directoryMember?: string;
            directoryUser?: string;
            membership?: string;
            organization?: string;
            user?: string;
          };
          membership: string;
          role: string;
        },
        {
          at: number;
          deleted: boolean;
          organization: string;
          role: string;
          status: "active" | "inactive" | "pending";
          user: string;
          workosId: string;
        },
        Name
      >;
      updateOrganization: FunctionReference<
        "action",
        "internal",
        {
          domains?: Array<{ domain: string; state: "pending" | "verified" }>;
          externalId?: string;
          handles: {
            connection?: string;
            directory?: string;
            directoryGroup?: string;
            directoryMember?: string;
            directoryUser?: string;
            membership?: string;
            organization?: string;
            user?: string;
          };
          name?: string;
          organization: string;
        },
        {
          at: number;
          deleted: boolean;
          externalId?: string;
          name: string;
          workosId: string;
        },
        Name
      >;
    };
    directory: {
      members: FunctionReference<
        "query",
        "internal",
        {
          group: string;
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
            at: number;
            deleted: boolean;
            directory: string;
            group: string;
            organization?: string;
            user: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      memberships: FunctionReference<
        "query",
        "internal",
        {
          of: { user: string } | { organization: string };
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
            at: number;
            deleted: boolean;
            organization: string;
            role: string;
            status: "active" | "inactive" | "pending";
            user: string;
            workosId: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      organization: FunctionReference<
        "query",
        "internal",
        { workosId: string },
        null | {
          at: number;
          deleted: boolean;
          externalId?: string;
          name: string;
          workosId: string;
        },
        Name
      >;
      route: FunctionReference<
        "query",
        "internal",
        { email: string },
        null | { connection?: string; organization: string; sso: boolean },
        Name
      >;
      status: FunctionReference<
        "query",
        "internal",
        {},
        {
          bound: { apiKey: string | null; clientId: string | null };
          bounded: boolean;
          cursor: string | null;
          error?: {
            detail?: string;
            event?: string;
            key?: string;
            kind:
              | "credentials"
              | "expired"
              | "rejected"
              | "callback"
              | "decode"
              | "transient";
          };
          open: number;
          pending: boolean;
        },
        Name
      >;
    };
    portal: {
      link: FunctionReference<
        "action",
        "internal",
        {
          externalUserId?: string;
          intent:
            | "sso"
            | "dsync"
            | "audit_logs"
            | "log_streams"
            | "domain_verification"
            | "certificate_renewal"
            | "bring_your_own_key";
          organization: string;
          returnUrl?: string;
          successUrl?: string;
        },
        { link: string },
        Name
      >;
    };
    provider: {
      claimTicket: FunctionReference<
        "mutation",
        "internal",
        { stateHash: string; ticketCodeHash: string },
        null | { encryptedPayload: string },
        Name
      >;
      createAuthorizationRequest: FunctionReference<
        "mutation",
        "internal",
        { codeVerifier: string; redirectTo: string; stateHash: string },
        { callbackUrl: string; clientId: string },
        Name
      >;
    };
    sessions: {
      revoke: FunctionReference<
        "action",
        "internal",
        { user: string },
        number,
        Name
      >;
    };
    stream: {
      sweep: FunctionReference<
        "mutation",
        "internal",
        {
          handles: {
            connection?: string;
            directory?: string;
            directoryGroup?: string;
            directoryMember?: string;
            directoryUser?: string;
            membership?: string;
            organization?: string;
            user?: string;
          };
        },
        boolean,
        Name
      >;
    };
  };
