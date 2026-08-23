/**
 * Trusted WebAuthn attestation policies.
 *
 * @module
 */

import {
  MetadataService,
  type MetadataBLOBPayloadEntry,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import {
  decodeAttestationObject,
  isoBase64URL,
  verifyMDSBlob,
} from "@simplewebauthn/server/helpers";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

import type {
  WebAuthnAttestationEvidence,
  WebAuthnAttestationPolicy,
  WebAuthnAttestationVerificationInput,
} from "../../server/types";

const FIDO_MDS_URL = "https://mds.fidoalliance.org/";
const FIDO_MDS_VERIFIER = "fido-mds-v3";
const AAGUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ZERO_AAGUID = "00000000-0000-0000-0000-000000000000";

const REJECTED_AUTHENTICATOR_STATUSES = new Set([
  "REVOKED",
  "RETIRED",
  "USER_VERIFICATION_BYPASS",
  "ATTESTATION_KEY_COMPROMISE",
  "USER_KEY_REMOTE_COMPROMISE",
  "USER_KEY_PHYSICAL_COMPROMISE",
]);

const CERTIFIED_AUTHENTICATOR_STATUSES = new Set([
  "FIDO_CERTIFIED",
  "FIDO_CERTIFIED_L1",
  "FIDO_CERTIFIED_L1plus",
  "FIDO_CERTIFIED_L2",
  "FIDO_CERTIFIED_L2plus",
  "FIDO_CERTIFIED_L3",
  "FIDO_CERTIFIED_L3plus",
]);

type FidoMetadata = {
  entries: Map<string, MetadataBLOBPayloadEntry>;
  nextUpdate: number;
};

let cachedMetadata: FidoMetadata | undefined;
let metadataLoad: Promise<FidoMetadata> | undefined;

function normalizeAaguid(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!AAGUID_PATTERN.test(normalized)) {
    throw new Error(`Invalid AAGUID: ${value}`);
  }
  return normalized;
}

function normalizeAllowedAaguids(
  values: readonly string[] | undefined,
): ReadonlySet<string> | null {
  if (values === undefined) return null;
  if (values.length === 0) {
    throw new Error("fidoMds allowedAaguids must contain at least one AAGUID when provided.");
  }
  return new Set(values.map(normalizeAaguid));
}

/** @internal */
export function assertTrustedMetadataEntry(entry: MetadataBLOBPayloadEntry | undefined): void {
  if (!entry?.aaguid || !entry.metadataStatement) {
    throw new Error("Authenticator is not present in the verified FIDO Metadata Service.");
  }
  const rejected = entry.statusReports.find((report) =>
    REJECTED_AUTHENTICATOR_STATUSES.has(report.status),
  );
  if (rejected) {
    throw new Error(`Authenticator metadata status is ${rejected.status}.`);
  }
  if (!entry.statusReports.some((report) => CERTIFIED_AUTHENTICATOR_STATUSES.has(report.status))) {
    throw new Error("Authenticator does not have a current FIDO certification status.");
  }
}

/** @internal */
export function assertFullAttestation(attestationObject: string): void {
  const decoded = decodeAttestationObject(isoBase64URL.toBuffer(attestationObject));
  const format = decoded.get("fmt");
  const statement = decoded.get("attStmt");
  if (format === "none") {
    throw new Error("Authenticator did not return an attestation statement.");
  }
  if (format === "fido-u2f") {
    throw new Error(
      "Legacy FIDO U2F attestation has no model AAGUID and cannot satisfy this policy.",
    );
  }
  const certificates = statement.get("x5c");
  if (!certificates?.length) {
    throw new Error("Self or anonymous attestation is not trusted by this policy.");
  }
}

async function loadFidoMetadata(): Promise<FidoMetadata> {
  const response = await fetch(FIDO_MDS_URL);
  if (!response.ok) {
    throw new Error(`FIDO Metadata Service returned HTTP ${response.status}.`);
  }
  const verified = await verifyMDSBlob(await response.text());
  await MetadataService.initialize({
    mdsServers: [],
    statements: verified.statements,
    verificationMode: "strict",
  });

  const entries = new Map<string, MetadataBLOBPayloadEntry>();
  for (const entry of verified.payload.entries) {
    if (entry.aaguid) entries.set(normalizeAaguid(entry.aaguid), entry);
  }
  return { entries, nextUpdate: verified.parsedNextUpdate.getTime() };
}

async function getFidoMetadata(): Promise<FidoMetadata> {
  if (cachedMetadata && Date.now() < cachedMetadata.nextUpdate) return cachedMetadata;
  metadataLoad ??= loadFidoMetadata()
    .then((metadata) => {
      cachedMetadata = metadata;
      return metadata;
    })
    .finally(() => {
      metadataLoad = undefined;
    });
  return await metadataLoad;
}

function assertAllowedAaguid(aaguid: string, allowed: ReadonlySet<string> | null): void {
  if (aaguid === ZERO_AAGUID) {
    throw new Error("Authenticator did not provide a model-specific AAGUID.");
  }
  if (allowed && !allowed.has(aaguid)) {
    throw new Error(`Authenticator AAGUID ${aaguid} is not allowed by this policy.`);
  }
}

async function verifyWithFidoMds(
  input: WebAuthnAttestationVerificationInput,
  allowed: ReadonlySet<string> | null,
): Promise<Omit<WebAuthnAttestationEvidence, "status" | "verifiedAt" | "verifier">> {
  assertFullAttestation(input.attestationObject);
  const metadata = await getFidoMetadata();
  const responseData: RegistrationResponseJSON["response"] = {
    clientDataJSON: input.clientDataJSON,
    attestationObject: input.attestationObject,
  };
  if (input.transports !== undefined) {
    responseData.transports =
      input.transports as RegistrationResponseJSON["response"]["transports"];
  }
  const response: RegistrationResponseJSON = {
    id: input.credentialId,
    rawId: input.credentialId,
    type: "public-key",
    response: responseData,
    clientExtensionResults: {},
  };
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: input.expectedChallenge,
    expectedOrigin: input.expectedOrigin,
    expectedRPID: input.expectedRpId,
    requireUserPresence: true,
    requireUserVerification: input.requireUserVerification,
    supportedAlgorithmIDs: input.supportedAlgorithms,
  });
  if (!result.verified) throw new Error("Authenticator attestation verification failed.");

  const aaguid = normalizeAaguid(result.registrationInfo.aaguid);
  assertAllowedAaguid(aaguid, allowed);
  const entry = metadata.entries.get(aaguid);
  assertTrustedMetadataEntry(entry);
  return {
    aaguid,
    format: result.registrationInfo.fmt,
    metadataDescription: entry?.metadataStatement?.description,
  };
}

/** Options for {@link fidoMds}. */
export interface FidoMdsOptions {
  /**
   * Optional model allow list. Omit it to accept any authenticator with a
   * currently trusted FIDO MDS entry and full manufacturer attestation.
   */
  allowedAaguids?: readonly string[];
}

/**
 * Require full manufacturer attestation verified against FIDO Metadata
 * Service v3. Missing, self, anonymous, unknown, revoked, compromised, and
 * optionally non-allow-listed authenticators are rejected.
 *
 * The metadata blob, signature, certificate path, and status reports are
 * refreshed from the official FIDO service. A metadata outage therefore fails
 * registration and strict sign-in closed.
 *
 * @param options - Optional authenticator model allow list.
 * @returns A strict policy for `webauthn({ registration: { attestation } })`.
 *
 * @example
 * ```ts
 * import { webauthn } from "@estifanos-sh/convex-auth/providers/webauthn";
 *
 * webauthn({
 *   registration: {
 *     authenticatorAttachment: "cross-platform",
 *     hints: ["security-key"],
 *     attestation: webauthn.attestation.fidoMds({
 *       allowedAaguids: ["2fc0579f-8113-47ea-b116-bb5a8db9202a"],
 *     }),
 *   },
 * });
 * ```
 */
export function fidoMds(options: FidoMdsOptions = {}): WebAuthnAttestationPolicy {
  const allowed = normalizeAllowedAaguids(options.allowedAaguids);
  return {
    conveyance: "direct",
    verifier: {
      id: FIDO_MDS_VERIFIER,
      verify: async (input) => await verifyWithFidoMds(input, allowed),
      assertTrusted: async (evidence) => {
        if (evidence.status !== "trusted" || evidence.verifier !== FIDO_MDS_VERIFIER) {
          throw new Error("Credential has no trusted FIDO MDS attestation evidence.");
        }
        const aaguid = normalizeAaguid(evidence.aaguid);
        assertAllowedAaguid(aaguid, allowed);
        const metadata = await getFidoMetadata();
        assertTrustedMetadataEntry(metadata.entries.get(aaguid));
      },
    },
  };
}
