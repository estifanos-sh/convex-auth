import type { OidcConfigShape } from "./oidc";
import type { SamlConfigShape } from "./saml";
import { asRecord } from "./shared";
import type { ConnectionProtocol } from "../types";

const getProtocolConfig = (config: unknown, protocol: ConnectionProtocol) => {
  const base = asRecord(config);
  const direct = base?.[protocol];
  const viaProtocols = asRecord(base?.protocols)?.[protocol];
  return asRecord(direct) ?? asRecord(viaProtocols) ?? {};
};

/** @internal */
export function getOidcConfig(config: unknown): OidcConfigShape {
  return getProtocolConfig(config, "oidc") as OidcConfigShape;
}

/** @internal */
export function getPublicOidcConfig(config: unknown): OidcConfigShape {
  const oidc = getOidcConfig(config);
  if (!oidc.client) return oidc;
  return { ...oidc, client: { ...oidc.client, secret: undefined } };
}

/** @internal */
export function withOidcSecretState(config: Record<string, unknown>, hasClientSecret: boolean) {
  return {
    ...config,
    hasClientSecret,
  };
}

/** @internal */
export function getSamlConfig(config: unknown): SamlConfigShape {
  return getProtocolConfig(config, "saml") as SamlConfigShape;
}

/**
 * SAML config with the service-provider private-key material stripped, parallel
 * to `getPublicOidcConfig` stripping the OIDC client secret. The SP signing/
 * decryption keys are stored in config but must never leave the server.
 * @internal
 */
export function getPublicSamlConfig(config: unknown): SamlConfigShape {
  const saml = getSamlConfig(config);
  if (Array.isArray(saml)) return {};
  const sp = saml.serviceProvider;
  if (sp === undefined || sp === null) return saml;
  if (Array.isArray(sp) || typeof sp !== "object") {
    return { ...saml, serviceProvider: undefined };
  }
  return {
    ...saml,
    serviceProvider: {
      ...sp,
      privateKey: undefined,
      privateKeyPass: undefined,
      encPrivateKey: undefined,
      encPrivateKeyPass: undefined,
    },
  };
}

/**
 * Redact every protocol secret from a whole connection config before it is
 * returned to a client: the OIDC client secret and the SAML SP private-key
 * material. Used by the connection read facade (`get`/`list`) which would
 * otherwise hand back the raw stored config.
 * @internal
 */
export function getPublicConnectionConfig(config: unknown) {
  const base = asRecord(config);
  if (base === null || Array.isArray(base)) return {};
  const next = { ...base };
  const protocols = asRecord(base.protocols);
  if (protocols === null || Array.isArray(protocols)) {
    delete next.protocols;
  } else {
    const publicProtocols = { ...protocols };
    if (protocols.oidc !== undefined) publicProtocols.oidc = getPublicOidcConfig(config);
    if (protocols.saml !== undefined) publicProtocols.saml = getPublicSamlConfig(config);
    next.protocols = publicProtocols;
  }
  if (base.oidc !== undefined) next.oidc = getPublicOidcConfig(config);
  if (base.saml !== undefined) next.saml = getPublicSamlConfig(config);
  return next;
}

/** @internal */
export function upsertProtocolConfig(
  config: unknown,
  protocol: ConnectionProtocol,
  protocolConfig: Record<string, unknown>,
) {
  const base = asRecord(config) ?? {};
  const protocols = asRecord(base.protocols) ?? {};
  protocols[protocol] = {
    ...asRecord(protocols[protocol]),
    ...protocolConfig,
  };
  return { ...base, protocols };
}
