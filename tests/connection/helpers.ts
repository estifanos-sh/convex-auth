import { randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";

import { api } from "@convex/_generated/api";
import type { AuthEventKind } from "@estifanos-sh/convex-auth/server";
import { ConvexHttpClient } from "convex/browser";
import type { Value } from "convex/values";
import { inject } from "vite-plus/test";

declare module "vite-plus/test" {
  interface ProvidedContext {
    zitadelAdminPat: string;
    zitadelLoginClientPat: string;
    zitadelPublicUrl: string;
    zitadelInternalUrl: string;
    convexSelfHostedUrl: string;
    convexSiteUrl: string;
  }
}

export interface SimpleResponse {
  ok: boolean;
  status: number;
  headers: Headers & { getSetCookie: () => string[] };
  text: () => Promise<string>;
}

export interface ConvexSignInResult {
  kind: string;
  session?: { token: string; refreshToken: string } | null;
}

export interface InteropRuntime {
  convexApiUrl: string;
  convexSiteUrl: string;
  zitadelBaseUrl: string;
  zitadelRuntimeBaseUrl: string;
  managementToken: string;
  loginToken: string;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function resolveHostname(hostname: string): string {
  if (hostname === "host.docker.internal") {
    return "127.0.0.1";
  }
  return hostname;
}

export function randomSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export function getInteropRuntime(): InteropRuntime {
  const convexApiUrl = trimTrailingSlash(inject("convexSelfHostedUrl"));
  const convexSiteUrl = trimTrailingSlash(inject("convexSiteUrl"));
  const zitadelBaseUrl = trimTrailingSlash(inject("zitadelPublicUrl"));
  const zitadelRuntimeBaseUrl = trimTrailingSlash(inject("zitadelInternalUrl"));
  const managementToken = inject("zitadelAdminPat");
  const loginToken = inject("zitadelLoginClientPat") || managementToken;
  return {
    convexApiUrl,
    convexSiteUrl,
    zitadelBaseUrl,
    zitadelRuntimeBaseUrl,
    managementToken,
    loginToken,
  };
}

export function normalizeRuntimeIssuer(value: string) {
  return trimTrailingSlash(value);
}

export function parseSetCookieHeaders(response: {
  headers: Headers & { getSetCookie?: () => string[] };
}) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }

  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    return [] as string[];
  }

  const result: string[] = [];
  let current = "";
  let inExpires = false;
  for (let i = 0; i < setCookie.length; i += 1) {
    const char = setCookie[i];
    const next = setCookie[i + 1];
    current += char;
    if (current.toLowerCase().endsWith("expires=")) {
      inExpires = true;
      continue;
    }
    if (inExpires && char === ";") {
      inExpires = false;
      continue;
    }
    if (!inExpires && char === "," && next === " ") {
      result.push(current.slice(0, -1).trim());
      current = "";
      i += 1;
    }
  }
  if (current.trim() !== "") {
    result.push(current.trim());
  }
  return result;
}

export function updateCookieJar(jar: Map<string, string>, setCookies: string[]) {
  for (const raw of setCookies) {
    const [cookiePair] = raw.split(";");
    if (!cookiePair) {
      continue;
    }
    const index = cookiePair.indexOf("=");
    if (index < 1) {
      continue;
    }
    const name = cookiePair.slice(0, index).trim();
    const value = cookiePair.slice(index + 1).trim();
    if (value === "") {
      jar.delete(name);
      continue;
    }
    jar.set(name, value);
  }
}

export function cookieHeader(jar: Map<string, string>) {
  if (jar.size === 0) {
    return undefined;
  }
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

export function rewriteUrlForHostAccess(
  url: string,
  runtimeBaseUrl: string,
  publicBaseUrl: string,
) {
  if (!url.startsWith(runtimeBaseUrl)) {
    return url;
  }
  return `${publicBaseUrl}${url.slice(runtimeBaseUrl.length)}`;
}

export function extractAuthRequestId(location: string, baseUrl?: string) {
  const url = new URL(location, baseUrl);
  for (const key of ["authRequest", "auth_request", "authRequestId", "auth_request_id"]) {
    const value = url.searchParams.get(key);
    if (value) {
      return value;
    }
  }
  throw new Error(`Unable to extract auth request id from ${location}`);
}

export function extractSamlRequestIdFromLoginUrl(location: string, base?: string) {
  const url = new URL(location, base);
  for (const key of [
    "samlRequest",
    "saml_request",
    "samlRequestId",
    "saml_request_id",
    "authRequest",
    "auth_request",
    "authRequestId",
    "auth_request_id",
  ]) {
    const value = url.searchParams.get(key);
    if (value) {
      return value;
    }
  }
  throw new Error(`Could not find saml request id in location: ${location}`);
}

export function parseSamlPostFormFromHtml(html: string) {
  const actionMatch = html.match(/<form[^>]+action="([^"]+)"/i);
  if (!actionMatch) {
    throw new Error("Could not find form action in SAML POST response.");
  }
  const fields: Record<string, string> = {};
  let match: RegExpExecArray | null;
  const inputPattern = /<input[^>]+name="([^"]*)"[^>]+value="([^"]*)"/gi;
  while ((match = inputPattern.exec(html)) !== null) {
    fields[match[1]] = match[2].replace(/&amp;/g, "&");
  }
  const reverseInputPattern = /<input[^>]+value="([^"]*)"[^>]+name="([^"]*)"/gi;
  while ((match = reverseInputPattern.exec(html)) !== null) {
    if (!(match[2] in fields)) {
      fields[match[2]] = match[1].replace(/&amp;/g, "&");
    }
  }
  return {
    action: actionMatch[1].replace(/&amp;/g, "&"),
    fields,
  };
}

export function buildFormBody(fields: Record<string, string>) {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function toHeadersObject(headers: Headers) {
  return Object.fromEntries(headers.entries());
}

export function requestHttp(input: string, init: RequestOptions = {}): Promise<SimpleResponse> {
  const url = new URL(input);
  const request = url.protocol === "https:" ? https.request : http.request;
  const headers = new Headers(init.headers);
  const method = init.method ?? "GET";
  const body = init.body;

  if (!headers.has("host")) {
    headers.set("host", url.host);
  }

  if (body !== undefined && !headers.has("content-length")) {
    headers.set("content-length", String(Buffer.byteLength(body)));
  }

  return new Promise((resolve, reject) => {
    const req = request(
      {
        protocol: url.protocol,
        hostname: resolveHostname(url.hostname),
        port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method,
        headers: toHeadersObject(headers),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const normalizedHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (key === "set-cookie") {
              continue;
            }
            if (Array.isArray(value)) {
              normalizedHeaders.set(key, value.join(", "));
              continue;
            }
            if (typeof value === "string") {
              normalizedHeaders.set(key, value);
            }
          }

          const setCookieHeader = response.headers["set-cookie"];
          const setCookies =
            setCookieHeader === undefined
              ? []
              : Array.isArray(setCookieHeader)
                ? setCookieHeader
                : [setCookieHeader];

          const headersWithSetCookie = Object.assign(normalizedHeaders, {
            getSetCookie: () => setCookies,
          }) as Headers & { getSetCookie: () => string[] };

          resolve({
            ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) <= 299,
            status: response.statusCode ?? 0,
            headers: headersWithSetCookie,
            text: async () => text,
          });
        });
      },
    );

    req.on("error", reject);

    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

export async function requestJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const response = await requestHttp(url, opts);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${opts.method ?? "GET"} ${url} failed: ${response.status} ${text}`);
  }
  if (text === "") {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

async function groupRpc<T>(
  convexClient: ConvexHttpClient,
  userToken: string,
  kind: "action" | "mutation" | "query",
  functionPath: string[],
  args: Record<string, Value>,
): Promise<T> {
  convexClient.setAuth(userToken);
  let reference: any = api as any;
  for (const segment of functionPath) {
    reference = reference?.[segment];
  }
  if (!reference) {
    throw new Error(`Group Connection RPC function not found: ${functionPath.join(".")}`);
  }
  switch (kind) {
    case "mutation":
      return (await convexClient.mutation(reference, args)) as T;
    case "query":
      return (await convexClient.query(reference, args)) as T;
    default:
      return (await convexClient.action(reference, args)) as T;
  }
}

type GroupRpcResult = {
  [key: string]: boolean | number | string | null | GroupRpcResult | GroupRpcResult[];
};

export async function groupCreateRpc(
  convexClient: ConvexHttpClient,
  userToken: string,
  args: { name: string },
): Promise<{ groupId: string }> {
  convexClient.setAuth(userToken);
  return (await convexClient.mutation((api as any).groups.create, args)) as {
    groupId: string;
  };
}

export async function groupConnectionCreateRpc(
  convexClient: ConvexHttpClient,
  userToken: string,
  args: {
    groupId: string;
    name?: string;
    slug?: string;
    protocol: "oidc" | "saml";
    status?: "draft" | "active" | "disabled";
    domain?: string;
  },
): Promise<{ connectionId: string; groupId: string }> {
  return await groupRpc(
    convexClient,
    userToken,
    "mutation",
    ["auth", "group", "createConnection"],
    args as any,
  );
}

export async function groupOidcConfigureRpc(
  convexClient: ConvexHttpClient,
  userToken: string,
  args: {
    connectionId: string;
    discovery: {
      issuer?: string;
      discoveryUrl?: string;
      audience?: string | string[];
      jwksUri?: string;
    };
    client: {
      id: string;
      secret?: string;
      authMethod?: "client_secret_post" | "client_secret_basic";
    };
    request?: {
      scopes?: string[];
      authorizationParams?: Record<string, string>;
      loginHint?: string;
    };
    security?: {
      clockToleranceSeconds?: number;
    };
    profile?: {
      mapping?: {
        subject?: string;
        email?: string;
        emailVerified?: string;
        name?: string;
        image?: string;
        groups?: string;
        roles?: string;
      };
      extraFields?: Record<string, string>;
    };
  },
): Promise<GroupRpcResult> {
  return await groupRpc(
    convexClient,
    userToken,
    "mutation",
    ["auth", "group", "setOidc"],
    args as any,
  );
}

export async function groupSamlConfigureRpc(
  convexClient: ConvexHttpClient,
  userToken: string,
  args: {
    connectionId: string;
    metadata: {
      xml?: string;
      url?: string;
    };
    domains?: string[];
    request?: {
      signAuthnRequests?: boolean;
      nameIdFormat?: string;
      forceAuthn?: boolean;
      authnContextClassRefs?: string[];
    };
    security?: {
      requireSignedAssertions?: boolean;
      requireTimestamps?: boolean;
      clockSkewSeconds?: number;
      weakAlgorithmHandling?: "warn" | "reject";
      maxMetadataSize?: number;
      maxResponseSize?: number;
    };
    profile?: {
      mapping?: {
        subject?: string;
        email?: string;
        name?: string;
        firstName?: string;
        lastName?: string;
        image?: string;
        groups?: string;
        roles?: string;
      };
      extraFields?: Record<string, string>;
    };
    serviceProvider?: {
      entityId?: string;
      acsUrl?: string;
      sloUrl?: string;
      signingCert?: string | string[];
      encryptCert?: string | string[];
      privateKey?: string;
      privateKeyPass?: string;
      encPrivateKey?: string;
      encPrivateKeyPass?: string;
    };
  },
): Promise<GroupRpcResult> {
  return await groupRpc(
    convexClient,
    userToken,
    "action",
    ["auth", "group", "setSaml"],
    args as any,
  );
}

export async function groupConnectionScimConfigureRpc(
  convexClient: ConvexHttpClient,
  userToken: string,
  args: {
    connectionId: string;
    status?: "draft" | "active" | "disabled";
    security?: {
      maxRequestSize?: number;
    };
    profile?: {
      mapping?: {
        subject?: string;
        externalId?: string;
        email?: string;
        firstName?: string;
        lastName?: string;
        name?: string;
        phone?: string;
        active?: string;
        groups?: string;
        roles?: string;
      };
      extraFields?: Record<string, string>;
    };
  },
): Promise<{ token?: string; configId?: string; basePath?: string }> {
  return await groupRpc(
    convexClient,
    userToken,
    "mutation",
    ["auth", "group", "setScim"],
    args as any,
  );
}

export async function groupWebhookEndpointCreateRpc(
  convexClient: ConvexHttpClient,
  userToken: string,
  args: {
    connectionId: string;
    url: string;
    secret: string;
    subscriptions: AuthEventKind[];
  },
): Promise<GroupRpcResult> {
  return await groupRpc(
    convexClient,
    userToken,
    "mutation",
    ["auth", "group", "createWebhookEndpoint"],
    args as any,
  );
}

export async function groupWebhookDeliveryListRpc(
  convexClient: ConvexHttpClient,
  userToken: string,
  args: {
    connectionId: string;
    paginationOpts?: { numItems: number; cursor: string | null };
  },
): Promise<{
  page: GroupRpcResult[];
  isDone: boolean;
  continueCursor: string;
}> {
  return await groupRpc(
    convexClient,
    userToken,
    "query",
    ["auth", "group", "listWebhookDeliveries"],
    args as any,
  );
}

export async function groupWebhookEndpointListRpc(
  convexClient: ConvexHttpClient,
  userToken: string,
  connectionId: string,
): Promise<GroupRpcResult[]> {
  return await groupRpc(
    convexClient,
    userToken,
    "query",
    ["auth", "group", "listWebhookEndpoints"],
    { connectionId },
  );
}

export async function groupAuditListRpc(
  convexClient: ConvexHttpClient,
  userToken: string,
  args: {
    connectionId: string;
    paginationOpts?: { numItems: number; cursor: string | null };
  },
): Promise<{
  page: GroupRpcResult[];
  isDone: boolean;
  continueCursor: string;
}> {
  return await groupRpc(
    convexClient,
    userToken,
    "query",
    ["auth", "group", "listAudit"],
    args as any,
  );
}
