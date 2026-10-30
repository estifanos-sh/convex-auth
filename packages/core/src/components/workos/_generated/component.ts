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
    directory: {
      findUsers: FunctionReference<
        "query",
        "internal",
        { idpId: string; organizationId: string },
        Array<{
          directoryId: string;
          email?: string;
          firstName?: string;
          id: string;
          idpId: string;
          lastName?: string;
          organizationId?: string;
          state: string;
        }>,
        Name
      >;
      getOrganization: FunctionReference<
        "query",
        "internal",
        { id: string },
        null | { externalId?: string; id: string; name: string },
        Name
      >;
      getUser: FunctionReference<
        "query",
        "internal",
        { id: string },
        null | {
          directoryId: string;
          email?: string;
          firstName?: string;
          id: string;
          idpId: string;
          lastName?: string;
          organizationId?: string;
          state: string;
        },
        Name
      >;
      listDirectories: FunctionReference<
        "query",
        "internal",
        { organizationId: string },
        Array<{
          id: string;
          name: string;
          organizationId?: string;
          state: string;
          type: string;
        }>,
        Name
      >;
      listGroups: FunctionReference<
        "query",
        "internal",
        {
          directoryId: string;
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
            directoryId: string;
            id: string;
            name: string;
            organizationId?: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      listMembers: FunctionReference<
        "query",
        "internal",
        {
          groupId: string;
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
          page: Array<{ directoryId: string; groupId: string; userId: string }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      listUserGroups: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          directoryId: string;
          id: string;
          name: string;
          organizationId?: string;
        }>,
        Name
      >;
      listUsers: FunctionReference<
        "query",
        "internal",
        {
          directoryId: string;
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
            directoryId: string;
            email?: string;
            firstName?: string;
            id: string;
            idpId: string;
            lastName?: string;
            organizationId?: string;
            state: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      route: FunctionReference<
        "query",
        "internal",
        { email: string },
        null | { organizationId: string },
        Name
      >;
    };
    portal: {
      generateLink: FunctionReference<
        "action",
        "internal",
        {
          intent:
            "sso" | "dsync" | "domain_verification" | "certificate_renewal";
          organizationId: string;
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
        {
          callbackUrl?: string;
          codeVerifier: string;
          redirectTo: string;
          stateHash: string;
        },
        { callbackUrl: string; clientId: string },
        Name
      >;
    };
    sync: {
      start: FunctionReference<
        "mutation",
        "internal",
        { onChange: string },
        null,
        Name
      >;
      status: FunctionReference<
        "query",
        "internal",
        {},
        {
          error?: string;
          phase: "idle" | "backfill" | "prune" | "events";
          running: boolean;
        },
        Name
      >;
    };
    webhook: {
      register: FunctionReference<
        "action",
        "internal",
        {},
        { created: boolean; endpointId: string },
        Name
      >;
    };
  };
