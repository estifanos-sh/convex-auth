import type { BindingKind } from "./saml/constants";

/** @internal */
export type ParsedSamlMetadata = {
  entityId: string;
  issuer: string;
  connection: {
    redirect?: string;
    post?: string;
  };
  slo: {
    redirect?: string;
    post?: string;
  };
  signingCert: string | string[] | null;
  encryptionCert: string | string[] | null;
  nameIdFormats: string[];
  wantsSignedAuthnRequests: boolean;
};

/** @internal */
export type GroupSamlSource = { kind: "connection"; id: string };

/** @internal */
export type GroupSamlRelayState = {
  source: GroupSamlSource;
  signature: string;
  requestId: string;
  state: string;
  redirectTo?: string;
};

/** @internal */
export type GroupSamlUrls = {
  metadataUrl: string;
  acsUrl: string;
  sloUrl?: string;
};

/** @internal */
export type GroupSamlLoadedSource = {
  source: GroupSamlSource;
  config: unknown;
  status?: string;
};

/** @internal */
export type GroupSamlHttpRequest = {
  url: URL;
  body: Record<string, string>;
  query: Record<string, string>;
  binding: BindingKind;
  relayState?: string;
  hasSamlRequest: boolean;
  hasSamlResponse: boolean;
};

/** @internal */
export type ScimListRequest = {
  startIndex: number;
  count: number;
  filter?: {
    attribute: string;
    operator: "eq" | "co" | "sw" | "ew" | "pr";
    value?: string;
  };
};

/** @internal */
export const SCIM_USER_SCHEMA_ID = "urn:ietf:params:scim:schemas:core:2.0:User";
/** @internal */
export const SCIM_GROUP_SCHEMA_ID = "urn:ietf:params:scim:schemas:core:2.0:Group";

/** @internal */
export const GROUP_OIDC_PROVIDER_PREFIX = "group:oidc:";
/** @internal */
export const GROUP_SAML_PROVIDER_PREFIX = "group:saml:";

/** @internal */
export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@+/, "");
}

/** @internal */
export function groupOidcProviderId(connectionId: string): string {
  return `${GROUP_OIDC_PROVIDER_PREFIX}${connectionId}`;
}

/** @internal */
export function groupSamlProviderId(connectionId: string): string {
  return `${GROUP_SAML_PROVIDER_PREFIX}${connectionId}`;
}

/** @internal */
export function getGroupSamlUrls(opts: {
  rootUrl: string;
  source: GroupSamlSource;
}): GroupSamlUrls {
  const root = opts.rootUrl.replace(/\/$/, "");
  const metadataBase = `${root}/connections/${opts.source.id}/saml/metadata`;
  const acsBase = `${root}/connections/${opts.source.id}/saml/acs`;
  const sloBase = `${root}/connections/${opts.source.id}/saml/slo`;
  return {
    metadataUrl: metadataBase,
    acsUrl: acsBase,
    sloUrl: sloBase,
  };
}

/** @internal */
export function getGroupOidcUrls(opts: {
  rootUrl: string;
  connectionId: string;
  sharedRedirectURI?: string;
}) {
  const root = opts.rootUrl.replace(/\/$/, "");
  const callbackUrl = (() => {
    if (typeof opts.sharedRedirectURI !== "string") {
      return `${root}/connections/${opts.connectionId}/oidc/callback`;
    }
    if (/^https?:\/\//.test(opts.sharedRedirectURI)) {
      return opts.sharedRedirectURI;
    }
    return `${root}${opts.sharedRedirectURI.startsWith("/") ? "" : "/"}${opts.sharedRedirectURI}`;
  })();
  return {
    signInUrl: `${root}/connections/${opts.connectionId}/oidc/signin`,
    callbackUrl,
  };
}

/** @internal */
export function encodeGroupOidcState(opts: { connectionId: string; state: string }) {
  const json = JSON.stringify(opts);
  const encoded =
    typeof btoa === "function" ? btoa(json) : Buffer.from(json, "utf8").toString("base64");
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** @internal */
export function decodeGroupOidcState(value: string | null) {
  if (!value) {
    throw new Error("Missing OIDC state.");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const decoded =
    typeof atob === "function" ? atob(padded) : Buffer.from(padded, "base64").toString("utf8");
  const parsed = JSON.parse(decoded) as {
    connectionId?: unknown;
    state?: unknown;
  };
  if (typeof parsed.connectionId !== "string" || typeof parsed.state !== "string") {
    throw new Error("Invalid OIDC state.");
  }
  return {
    connectionId: parsed.connectionId,
    state: parsed.state,
  };
}

/** @internal */
export function isGroupSamlSourceActive(source: GroupSamlLoadedSource) {
  return source.status === "active";
}

/** @internal */
export function isGroupProviderId(providerId: string): boolean {
  return (
    providerId.startsWith(GROUP_OIDC_PROVIDER_PREFIX) ||
    providerId.startsWith(GROUP_SAML_PROVIDER_PREFIX)
  );
}

export const asRecord = (value: unknown) =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
