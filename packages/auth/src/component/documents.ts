/**
 * Schema-derived validators for complete component documents.
 *
 * Keeping these validators attached to the schema makes the table definition
 * the single source of truth for both stored data and function return values.
 */

import schema from "./schema";

export const vUserDoc = schema.doc("User");
export const vUserEmailDoc = schema.doc("UserEmail");
export const vSessionDoc = schema.doc("Session");
export const vAccountDoc = schema.doc("Account");
export const vAuthVerifierDoc = schema.doc("AuthVerifier");
export const vAuthContinuationDoc = schema.doc("AuthContinuation");
export const vCredentialEnrollmentDoc = schema.doc("CredentialEnrollment");
export const vVerificationCodeDoc = schema.doc("VerificationCode");
export const vRefreshTokenDoc = schema.doc("RefreshToken");
export const vPasskeyDoc = schema.doc("Passkey");
export const vTotpFactorDoc = schema.doc("TotpFactor");
export const vGroupDoc = schema.doc("Group");
export const vGroupMemberDoc = schema.doc("GroupMember");
export const vGroupInviteDoc = schema.doc("GroupInvite");
export const vApiKeyDoc = schema.doc("ApiKey");
export const vOAuthClientDoc = schema.doc("OAuthClient");
export const vOAuthCodeDoc = schema.doc("OAuthCode");
export const vOAuthRefreshGrantDoc = schema.doc("OAuthRefreshGrant");
export const vOAuthRefreshTokenDoc = schema.doc("OAuthRefreshToken");
export const vDeviceCodeDoc = schema.doc("DeviceCode");
export const vGroupConnectionDoc = schema.doc("GroupConnection");
export const vGroupConnectionDomainDoc = schema.doc("GroupConnectionDomain");
export const vSamlLoginRequestDoc = schema.doc("SamlLoginRequest");
export const vSamlSeenAssertionDoc = schema.doc("SamlSeenAssertion");
export const vGroupConnectionDomainVerificationDoc = schema.doc(
  "GroupConnectionDomainVerification",
);
export const vGroupConnectionSecretDoc = schema.doc("GroupConnectionSecret");
export const vGroupConnectionScimConfigDoc = schema.doc("GroupConnectionScimConfig");
export const vGroupConnectionScimIdentityDoc = schema.doc("GroupConnectionScimIdentity");
export const vAuthEventProjectionDoc = schema.doc("AuthEventProjection");
export const vGroupWebhookEndpointDoc = schema.doc("GroupWebhookEndpoint");
export const vGroupWebhookDeliveryDoc = schema.doc("GroupWebhookDelivery");
