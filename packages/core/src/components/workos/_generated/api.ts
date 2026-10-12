/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as backfill from "../backfill.js";
import type * as changes from "../changes.js";
import type * as constants from "../constants.js";
import type * as credentials from "../credentials.js";
import type * as directory from "../directory.js";
import type * as exchange from "../exchange.js";
import type * as faults from "../faults.js";
import type * as http from "../http.js";
import type * as lane from "../lane.js";
import type * as mirror from "../mirror.js";
import type * as provider from "../provider.js";
import type * as stream from "../stream.js";
import type * as wire from "../wire.js";
import type * as workosApi from "../workosApi.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  backfill: typeof backfill;
  changes: typeof changes;
  constants: typeof constants;
  credentials: typeof credentials;
  directory: typeof directory;
  exchange: typeof exchange;
  faults: typeof faults;
  http: typeof http;
  lane: typeof lane;
  mirror: typeof mirror;
  provider: typeof provider;
  stream: typeof stream;
  wire: typeof wire;
  workosApi: typeof workosApi;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {
  lane: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"lane">;
};
