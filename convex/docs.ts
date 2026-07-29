/**
 * Upload API for the documentation static-hosting component.
 *
 * These internal functions are callable only through the Convex CLI. Keeping
 * documentation in its own component prevents docs deployments from replacing
 * the demo assets served by the root static-hosting component.
 *
 * @module
 */

import { exposeUploadApi } from "@convex-dev/static-hosting";

import { components } from "./_generated/api";

export const {
  generateUploadUrl,
  generateUploadUrls,
  recordAsset,
  recordAssets,
  gcOldAssets,
  listAssets,
} = exposeUploadApi(components.docsHosting);
