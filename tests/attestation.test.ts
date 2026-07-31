/** Trusted WebAuthn attestation policy tests. */

import { ConvexError } from "convex/values";
import { expect, test } from "vite-plus/test";

import {
  assertFullAttestation,
  assertTrustedMetadataEntry,
} from "../packages/auth/src/providers/attestation";
import { ErrorCode } from "../packages/auth/src/shared/codes";
import { assertStoredAttestationTrusted } from "../packages/auth/src/server/webauthn";
import type {
  WebAuthnAttestationEvidence,
  WebAuthnAttestationPolicy,
} from "../packages/auth/src/server/types";

function encoded(bytes: number[]): string {
  return Buffer.from(bytes).toString("base64url");
}

const NONE_ATTESTATION = encoded([
  0xa3, 0x63, 0x66, 0x6d, 0x74, 0x64, 0x6e, 0x6f, 0x6e, 0x65, 0x67, 0x61, 0x74, 0x74, 0x53, 0x74,
  0x6d, 0x74, 0xa0, 0x68, 0x61, 0x75, 0x74, 0x68, 0x44, 0x61, 0x74, 0x61, 0x40,
]);

const SELF_PACKED_ATTESTATION = encoded([
  0xa3, 0x63, 0x66, 0x6d, 0x74, 0x66, 0x70, 0x61, 0x63, 0x6b, 0x65, 0x64, 0x67, 0x61, 0x74, 0x74,
  0x53, 0x74, 0x6d, 0x74, 0xa2, 0x63, 0x61, 0x6c, 0x67, 0x26, 0x63, 0x73, 0x69, 0x67, 0x41, 0x00,
  0x68, 0x61, 0x75, 0x74, 0x68, 0x44, 0x61, 0x74, 0x61, 0x40,
]);

const TRUSTED_ENTRY = {
  aaguid: "2fc0579f-8113-47ea-b116-bb5a8db9202a",
  metadataStatement: { description: "YubiKey 5 NFC" },
  statusReports: [{ status: "FIDO_CERTIFIED_L2" }],
};

const EVIDENCE: WebAuthnAttestationEvidence = {
  verifier: "test-verifier",
  aaguid: "2fc0579f-8113-47ea-b116-bb5a8db9202a",
  format: "packed",
  metadataDescription: "YubiKey 5 NFC",
  verifiedAt: 1,
  status: "trusted",
};

test("strict attestation rejects none and self attestation before metadata lookup", () => {
  expect(() => assertFullAttestation(NONE_ATTESTATION)).toThrow(
    "did not return an attestation statement",
  );
  expect(() => assertFullAttestation(SELF_PACKED_ATTESTATION)).toThrow(
    "Self or anonymous attestation",
  );
});

test("strict metadata policy requires certification and rejects revoked or compromised models", () => {
  expect(() => assertTrustedMetadataEntry(undefined)).toThrow("not present");
  expect(() =>
    assertTrustedMetadataEntry({
      ...TRUSTED_ENTRY,
      statusReports: [{ status: "SELF_ASSERTION_SUBMITTED" }],
    } as never),
  ).toThrow("current FIDO certification");
  expect(() =>
    assertTrustedMetadataEntry({
      ...TRUSTED_ENTRY,
      statusReports: [{ status: "REVOKED" }],
    } as never),
  ).toThrow("REVOKED");
  expect(() =>
    assertTrustedMetadataEntry({
      ...TRUSTED_ENTRY,
      statusReports: [{ status: "ATTESTATION_KEY_COMPROMISE" }],
    } as never),
  ).toThrow("ATTESTATION_KEY_COMPROMISE");
  expect(() => assertTrustedMetadataEntry(TRUSTED_ENTRY as never)).not.toThrow();
});

test("strict sign-in rejects legacy credentials without attestation evidence", async () => {
  const policy: WebAuthnAttestationPolicy = {
    conveyance: "direct",
    verifier: {
      id: "test-verifier",
      verify: async () => ({ aaguid: EVIDENCE.aaguid, format: EVIDENCE.format }),
      assertTrusted: async () => {},
    },
  };

  const error = await assertStoredAttestationTrusted(policy, undefined).then(
    () => null,
    (caught) => caught,
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(
    ErrorCode.PASSKEY_UNTRUSTED_ATTESTATION,
  );
});

test("strict sign-in re-checks persisted attestation with the active verifier", async () => {
  let checked: WebAuthnAttestationEvidence | undefined;
  const policy: WebAuthnAttestationPolicy = {
    conveyance: "direct",
    verifier: {
      id: "test-verifier",
      verify: async () => ({ aaguid: EVIDENCE.aaguid, format: EVIDENCE.format }),
      assertTrusted: async (evidence) => {
        checked = evidence;
      },
    },
  };

  await assertStoredAttestationTrusted(policy, EVIDENCE);
  expect(checked).toEqual(EVIDENCE);
});
