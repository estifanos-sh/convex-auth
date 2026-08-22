/// <reference types="vite-plus/client" />

import resendTest from "@convex-dev/resend/test";
import staticHostingTest from "@convex-dev/static-hosting/test";
import authTest from "@estifanos-sh/convex-auth/test";
import { convexTest as baseConvexTest } from "convex-test";
import type { FunctionReference } from "convex/server";

import { generateKeys } from "@estifanos-sh/convex-auth/cli/keys";

type PrivateAuthTestApi = {
  connection: {
    webhook: {
      delivery: {
        begin: FunctionReference<
          "mutation",
          "internal",
          { id: string; occurredAt: number },
          {
            attemptCount: number;
            status: "pending" | "processing" | "delivered" | "failed";
          } | null
        >;
        settle: FunctionReference<
          "mutation",
          "internal",
          {
            error?: string;
            id: string;
            occurredAt: number;
            outcome: "success" | "failure";
            responseStatus?: number;
            retry: boolean;
          },
          null
        >;
      };
    };
  };
  event: {
    orderedEvents: FunctionReference<
      "query",
      "internal",
      { now: number },
      Array<{ kind: string; commitTs: bigint }>
    >;
  };
  maintenance: {
    backfillEpochs: FunctionReference<
      "mutation",
      "internal",
      { batchSize?: number; cursor?: string; table?: "User" | "Session" },
      { isDone: boolean; migrated: number; scanned: number; table: "User" | "Session" }
    >;
    pruneExpired: FunctionReference<
      "mutation",
      "internal",
      { batchSize: number; now?: number },
      Record<string, number>
    >;
  };
};

/** Access component-private functions from white-box tests. */
export const privateAuthForTest = (auth: unknown): PrivateAuthTestApi => auth as PrivateAuthTestApi;

/** Access the component-owned legacy epoch backfill from white-box tests. */
export const backfillEpochsForTest = (auth: unknown) =>
  privateAuthForTest(auth).maintenance.backfillEpochs;

/**
 * A typed handle for the auth component's `maintenance.pruneExpired`, which is an internal
 * (cron-driven) component mutation deliberately kept off the public `ComponentApi` so a mounting
 * app cannot invoke the bulk delete. `convex-test` still resolves it at runtime via the registered
 * module map, so white-box tests use this handle to trigger it.
 */
export const pruneExpiredForTest = (
  auth: unknown,
): FunctionReference<
  "mutation",
  "internal",
  { batchSize: number; now?: number },
  Record<string, number>
> => privateAuthForTest(auth).maintenance.pruneExpired;

if (!process.env.APP_URL) {
  process.env.APP_URL = "http://localhost:5173";
}

if (!process.env.CONVEX_SITE_URL) {
  process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";
}

if (!process.env.RESEND_API_KEY) {
  process.env.RESEND_API_KEY = "test-resend-api-key";
}

if (!process.env.GOOGLE_CLIENT_ID) {
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
}

if (!process.env.GOOGLE_CLIENT_SECRET) {
  process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
}

if (!process.env.AUTH_KEYS) {
  process.env.AUTH_KEYS = (await generateKeys()).AUTH_KEYS;
}

export * from "convex-test";

export const convexTest = ((
  schema: Parameters<typeof baseConvexTest>[0],
  modules = import.meta.glob("../../convex/**/*.*s"),
) => {
  const t = baseConvexTest(schema as never, modules as never);
  authTest.register(t as any, "auth");
  resendTest.register(t as any, "resend");
  staticHostingTest.register(t as any, "staticHosting");
  return t;
}) as typeof baseConvexTest;
