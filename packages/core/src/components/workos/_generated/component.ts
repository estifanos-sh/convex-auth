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
