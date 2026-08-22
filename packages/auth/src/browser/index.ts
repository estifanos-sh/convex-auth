/**
 * Browser-first auth client for `@estifanos-sh/convex-auth/browser`.
 *
 * This entrypoint wraps the framework-agnostic `client(...)`
 * helper with browser defaults such as `ConvexHttpClient`, local storage, URL
 * replacement, OAuth launching, and WebAuthn adapters.
 *
 * @module
 */

import { ConvexHttpClient } from "convex/browser";

import {
  client as createClient,
  resolveUrl,
  type ClientOptions,
  type PlatformAuthClient,
} from "../client/index";
import type { AuthApiRefs } from "../client/core/types";
import { createWebAuthnClient } from "./webauthn";
import { createBrowserRuntime } from "./runtime";

export type { PlatformAuthClient as AuthClient, ClientOptions } from "../client/index";

/**
 * Create a browser-configured auth client.
 *
 * Applies browser runtime defaults (`ConvexHttpClient` transport, local
 * storage, URL cleanup, OAuth launch, WebAuthn support) on top of the
 * framework-agnostic `client(...)` helper, then returns it directly — the core
 * owns OAuth launch/completion and initialization, driven by the injected
 * browser runtime.
 *
 * @param options - Browser client configuration. See {@link ClientOptions}.
 * @typeParam Api - Auth API references that control which factor helpers are
 *   available on the returned client.
 * @returns A browser auth client with the configured auth helpers.
 */
export function client<Api extends AuthApiRefs = AuthApiRefs>(
  options: ClientOptions<Api>,
): PlatformAuthClient<Api> {
  const runtime = mergeBrowserRuntime(options.runtime);
  const adapterFactories = {
    ...options.adapterFactories,
    webauthn: options.adapterFactories?.webauthn ?? ((deps) => createWebAuthnClient(deps)),
  };

  if (options.proxyPath !== undefined) {
    return createClient<Api>({
      ...options,
      storage: options.storage ?? null,
      runtime,
      adapterFactories,
    }) as unknown as PlatformAuthClient<Api>;
  }

  const url = options.url ?? resolveUrl(options.convex);
  return createClient<Api>({
    ...options,
    runtime,
    adapterFactories,
    httpClient: options.httpClient ?? new ConvexHttpClient(url),
  }) as unknown as PlatformAuthClient<Api>;
}

function mergeBrowserRuntime(
  runtime: ClientOptions["runtime"],
): NonNullable<ClientOptions["runtime"]> {
  const defaults = createBrowserRuntime();
  return {
    ...defaults,
    ...runtime,
    environment: runtime?.environment ?? defaults.environment,
    proxy: runtime?.proxy ?? defaults.proxy,
    storage: runtime?.storage === undefined ? defaults.storage : runtime.storage,
    location: runtime?.location ?? defaults.location,
    oauth: runtime?.oauth ?? defaults.oauth,
    sync: runtime?.sync ?? defaults.sync,
    mutex: runtime?.mutex ?? defaults.mutex,
  };
}
