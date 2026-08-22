import { randomBytes } from "node:crypto";

import { api } from "@convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { expect, test } from "vite-plus/test";

import {
  buildFormBody,
  cookieHeader,
  type ConvexSignInResult,
  extractAuthRequestId,
  extractSamlRequestIdFromLoginUrl,
  getInteropRuntime,
  normalizeRuntimeIssuer,
  parseSamlPostFormFromHtml,
  parseSetCookieHeaders,
  rewriteUrlForHostAccess,
  type SimpleResponse,
  updateCookieJar,
  groupCreateRpc,
  groupConnectionCreateRpc,
  groupOidcConfigureRpc,
  groupSamlConfigureRpc,
  randomSlug,
  requestHttp,
  requestJson,
} from "../helpers.js";

type ConvexConnectionStartResult = {
  kind: "redirect";
  redirect: string;
  verifier: string;
};

type ZitadelProjectResponse = {
  id?: string;
};

type ZitadelOidcAppResponse = {
  appId?: string;
  app_id?: string;
  clientId?: string;
  client_id?: string;
  clientSecret?: string;
  client_secret?: string;
};

type ZitadelAddHumanUserResponse = {
  userId?: string;
  user_id?: string;
};

type ZitadelCreateSessionResponse = {
  sessionId?: string;
  session_id?: string;
  sessionToken?: string;
  session_token?: string;
};

type ZitadelCreateCallbackResponse = {
  callbackUrl?: string;
  callback_url?: string;
};

type ZitadelSamlAppResponse = {
  appId?: string;
  app_id?: string;
  entityId?: string;
  entity_id?: string;
};

type ZitadelSamlRequestDetails = {
  samlRequest?: {
    id?: string;
    issuer?: string;
    assertionConsumerService?: string;
    relayState?: string;
    binding?: string;
  };
};

type ZitadelFinalizeSamlResponse = {
  url?: string;
  post?: {
    relayState?: string;
    samlResponse?: string;
  };
  binding?: {
    post?: {
      relayState?: string;
      samlResponse?: string;
    };
    redirect?: Record<string, never>;
  };
};

test("group oidc login interoperates with zitadel through api-driven flow", async () => {
  const {
    convexApiUrl,
    convexSiteUrl,
    zitadelBaseUrl,
    zitadelRuntimeBaseUrl,
    managementToken,
    loginToken,
  } = getInteropRuntime();

  const convexClient = new ConvexHttpClient(convexApiUrl, {
    skipConvexDeploymentUrlCheck: true,
    logger: false,
  });

  const signInResult = (await convexClient.action(api.auth.signIn, {
    request: { provider: "anonymous" },
  })) as ConvexSignInResult;

  expect(signInResult.kind).toBe("signedIn");
  const convexUserToken = signInResult.session?.token;
  expect(convexUserToken).toBeTruthy();

  const runId = randomSlug("zitadel-interop");
  const { groupId } = await groupCreateRpc(convexClient, convexUserToken!, {
    name: `Zitadel Interop ${runId}`,
  });
  const connectionCreated = await groupConnectionCreateRpc(convexClient, convexUserToken!, {
    groupId,
    name: `Zitadel Interop ${runId}`,
    slug: runId,
    protocol: "oidc",
    status: "active",
  });

  const connectionId = connectionCreated.connectionId;
  expect(connectionId).toBeTruthy();

  const connectionCallbackUrl = `${convexSiteUrl}/connections/${connectionId}/oidc/callback`;
  const redirectTo = "https://example.com/callback";

  const project = await requestJson<ZitadelProjectResponse>(
    `${zitadelBaseUrl}/management/v1/projects`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${managementToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `convex-auth-${runId}`,
        projectRoleAssertion: true,
        projectRoleCheck: false,
        hasProjectCheck: false,
      }),
    },
  );
  const projectId = project.id;
  expect(projectId).toBeTruthy();

  const oidcApp = await requestJson<ZitadelOidcAppResponse>(
    `${zitadelBaseUrl}/management/v1/projects/${projectId}/apps/oidc`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${managementToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId,
        name: `convex-auth-oidc-${runId}`,
        redirectUris: [connectionCallbackUrl],
        responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
        grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"],
        appType: "OIDC_APP_TYPE_WEB",
        authMethodType: "OIDC_AUTH_METHOD_TYPE_BASIC",
        postLogoutRedirectUris: [redirectTo],
        version: "OIDC_VERSION_1_0",
        devMode: true,
        accessTokenType: "OIDC_TOKEN_TYPE_BEARER",
      }),
    },
  );

  const oidcClientId = oidcApp.clientId ?? oidcApp.client_id;
  const oidcClientSecret = oidcApp.clientSecret ?? oidcApp.client_secret;
  expect(oidcClientId).toBeTruthy();
  expect(oidcClientSecret).toBeTruthy();

  const zitadelUserPassword = `Zitadel-${randomBytes(8).toString("hex")}!`;
  const zitadelUser = await requestJson<ZitadelAddHumanUserResponse>(
    `${zitadelBaseUrl}/management/v1/users/human`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${managementToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userName: `convex-auth-${runId}`,
        profile: {
          firstName: "Convex",
          lastName: "Auth",
          displayName: "Convex Auth",
          preferredLanguage: "en",
          gender: "GENDER_UNSPECIFIED",
        },
        email: {
          email: `${runId}@example.com`,
          isEmailVerified: true,
        },
        initialPassword: zitadelUserPassword,
      }),
    },
  );

  const zitadelUserId = zitadelUser.userId ?? zitadelUser.user_id;
  expect(zitadelUserId).toBeTruthy();

  await requestJson<Record<string, never>>(
    `${zitadelBaseUrl}/management/v1/users/${zitadelUserId}/password`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${managementToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        password: zitadelUserPassword,
        noChangeRequired: true,
      }),
    },
  );

  await groupOidcConfigureRpc(convexClient, convexUserToken!, {
    connectionId,
    discovery: {
      issuer: normalizeRuntimeIssuer(zitadelBaseUrl),
      discoveryUrl: `${zitadelRuntimeBaseUrl}/.well-known/openid-configuration`,
    },
    client: {
      id: oidcClientId!,
      secret: oidcClientSecret,
    },
    request: {
      scopes: ["openid", "profile", "email"],
    },
  });

  const ssoResult = (await convexClient.action(api.auth.signIn, {
    request: { provider: "connection", params: { connectionId } },
  })) as ConvexConnectionStartResult;
  expect(ssoResult.kind).toBe("redirect");
  const { redirect: signInUrl, verifier } = ssoResult;
  const convexCookies = new Map<string, string>();

  const signInResponse = await requestHttp(signInUrl);
  if (signInResponse.status !== 302) {
    throw new Error(`OIDC signin failed: ${signInResponse.status} ${await signInResponse.text()}`);
  }
  expect(signInResponse.status).toBe(302);
  updateCookieJar(convexCookies, parseSetCookieHeaders(signInResponse));

  const authorizeLocation = signInResponse.headers.get("location");
  if (!authorizeLocation) {
    throw new Error("OIDC signin did not return an authorization redirect.");
  }
  const authorizeUrl = rewriteUrlForHostAccess(
    authorizeLocation,
    zitadelRuntimeBaseUrl,
    zitadelBaseUrl,
  );

  const authorizeResponse = await requestHttp(authorizeUrl);
  expect(authorizeResponse.status).toBeGreaterThanOrEqual(300);
  expect(authorizeResponse.status).toBeLessThan(400);
  const authRequestLocation = authorizeResponse.headers.get("location");
  if (!authRequestLocation) {
    throw new Error("Authorize endpoint did not return an auth request redirect.");
  }

  const authRequestLocationForHost = rewriteUrlForHostAccess(
    authRequestLocation,
    zitadelRuntimeBaseUrl,
    zitadelBaseUrl,
  );
  const authRequestUrl = new URL(authRequestLocationForHost, `${zitadelBaseUrl}/`).toString();
  const authRequestId = extractAuthRequestId(authRequestUrl);

  const authRequest = await requestJson<{ authRequest?: { id?: string } }>(
    `${zitadelBaseUrl}/v2/oidc/auth_requests/${authRequestId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${loginToken}`,
        "Content-Type": "application/json",
      },
    },
  );
  expect(authRequest.authRequest?.id).toBe(authRequestId);

  const session = await requestJson<ZitadelCreateSessionResponse>(`${zitadelBaseUrl}/v2/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      checks: {
        user: { userId: zitadelUserId },
        password: { password: zitadelUserPassword },
      },
    }),
  });

  const sessionId = session.sessionId ?? session.session_id;
  const sessionToken = session.sessionToken ?? session.session_token;
  expect(sessionId).toBeTruthy();
  expect(sessionToken).toBeTruthy();

  const callback = await requestJson<ZitadelCreateCallbackResponse>(
    `${zitadelBaseUrl}/v2/oidc/auth_requests/${authRequestId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${loginToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          sessionId,
          sessionToken,
        },
      }),
    },
  );

  const callbackUrl = callback.callbackUrl ?? callback.callback_url;
  if (!callbackUrl) {
    throw new Error("ZITADEL callback URL was not returned.");
  }

  const callbackResponse = await requestHttp(
    rewriteUrlForHostAccess(callbackUrl, zitadelRuntimeBaseUrl, zitadelBaseUrl),
    {
      headers: {
        Cookie: cookieHeader(convexCookies) ?? "",
      },
    },
  );

  expect(callbackResponse.status).toBe(302);
  const completionLocation = callbackResponse.headers.get("location");
  if (!completionLocation) {
    throw new Error("Group Connection callback did not return completion redirect.");
  }

  const verificationCode = new URL(completionLocation).searchParams.get("code");
  expect(verificationCode).toBeTruthy();

  const exchanged = (await convexClient.action(api.auth.signIn, {
    request: { params: { code: verificationCode! } },
    verifier,
  })) as ConvexSignInResult;

  expect(exchanged.kind).toBe("signedIn");
  expect(exchanged.session?.token).toBeTruthy();
  expect(exchanged.session?.refreshToken).toBeTruthy();
});

test("group saml login interoperates with zitadel through api-driven flow", async () => {
  const {
    convexApiUrl,
    convexSiteUrl,
    zitadelBaseUrl,
    zitadelRuntimeBaseUrl,
    managementToken,
    loginToken,
  } = getInteropRuntime();

  const convexClient = new ConvexHttpClient(convexApiUrl, {
    skipConvexDeploymentUrlCheck: true,
    logger: false,
  });

  const signInResult = (await convexClient.action(api.auth.signIn, {
    request: { provider: "anonymous" },
  })) as ConvexSignInResult;

  expect(signInResult.kind).toBe("signedIn");
  const convexUserToken = signInResult.session?.token;
  expect(convexUserToken).toBeTruthy();

  const runId = randomSlug("saml-interop");
  const { groupId } = await groupCreateRpc(convexClient, convexUserToken!, {
    name: `SAML Interop ${runId}`,
  });
  const connectionCreated = await groupConnectionCreateRpc(convexClient, convexUserToken!, {
    groupId,
    name: `SAML Interop ${runId}`,
    slug: runId,
    protocol: "saml",
    status: "active",
  });

  const connectionId = connectionCreated.connectionId;
  expect(connectionId).toBeTruthy();

  const convexAcsUrl = `${convexSiteUrl}/connections/${connectionId}/saml/acs`;
  const convexEntityId = `${convexSiteUrl}/connections/${connectionId}/saml/metadata`;
  const spMetadataXml = [
    `<?xml version="1.0"?>`,
    `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"`,
    `  entityID="${convexEntityId}">`,
    `  <md:SPSSODescriptor`,
    `    AuthnRequestsSigned="false"`,
    `    WantAssertionsSigned="true"`,
    `    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">`,
    `    <md:AssertionConsumerService`,
    `      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"`,
    `      Location="${convexAcsUrl}"`,
    `      index="1"/>`,
    `  </md:SPSSODescriptor>`,
    `</md:EntityDescriptor>`,
  ].join("\n");

  const project = await requestJson<ZitadelProjectResponse>(
    `${zitadelBaseUrl}/management/v1/projects`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${managementToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `convex-auth-saml-${runId}`,
        projectRoleAssertion: true,
        projectRoleCheck: false,
        hasProjectCheck: false,
      }),
    },
  );
  const projectId = project.id;
  expect(projectId).toBeTruthy();

  const samlApp = await requestJson<ZitadelSamlAppResponse>(
    `${zitadelBaseUrl}/management/v1/projects/${projectId}/apps/saml`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${managementToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `convex-auth-saml-app-${runId}`,
        metadataXml: Buffer.from(spMetadataXml).toString("base64"),
      }),
    },
  );
  const samlAppId = samlApp.appId ?? samlApp.app_id;
  expect(samlAppId).toBeTruthy();

  const idpMetadataResponse = await requestHttp(`${zitadelBaseUrl}/saml/v2/metadata`);
  expect(idpMetadataResponse.status).toBe(200);
  const idpMetadataXml = await idpMetadataResponse.text();
  expect(idpMetadataXml).toContain("EntityDescriptor");

  await groupSamlConfigureRpc(convexClient, convexUserToken!, {
    connectionId,
    metadata: { xml: idpMetadataXml },
    request: {
      signAuthnRequests: false,
    },
    profile: {
      mapping: {
        subject: "UserID",
        email: "Email",
        name: "FullName",
        firstName: "FirstName",
        lastName: "SurName",
      },
    },
  });

  const zitadelUserPassword = `Saml-${randomBytes(8).toString("hex")}!`;
  const zitadelUser = await requestJson<ZitadelAddHumanUserResponse>(
    `${zitadelBaseUrl}/management/v1/users/human`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${managementToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userName: `saml-${runId}`,
        profile: {
          firstName: "SAML",
          lastName: "User",
          displayName: "SAML User",
          preferredLanguage: "en",
          gender: "GENDER_UNSPECIFIED",
        },
        email: {
          email: `${runId}@example.com`,
          isEmailVerified: true,
        },
        initialPassword: zitadelUserPassword,
      }),
    },
  );
  const zitadelUserId = zitadelUser.userId ?? zitadelUser.user_id;
  expect(zitadelUserId).toBeTruthy();

  await requestJson<Record<string, never>>(
    `${zitadelBaseUrl}/management/v1/users/${zitadelUserId}/password`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${managementToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        password: zitadelUserPassword,
        noChangeRequired: true,
      }),
    },
  );

  const ssoResult = (await convexClient.action(api.auth.signIn, {
    request: { provider: "connection", params: { connectionId, protocol: "saml" } },
  })) as ConvexConnectionStartResult;
  expect(ssoResult.kind).toBe("redirect");
  const { redirect: signInUrl, verifier } = ssoResult;
  const convexCookies = new Map<string, string>();

  const signInResponse = await requestHttp(signInUrl);
  updateCookieJar(convexCookies, parseSetCookieHeaders(signInResponse));

  let samlRequestId: string;

  if (signInResponse.status === 302) {
    const signInLocation = signInResponse.headers.get("location");
    if (!signInLocation) {
      throw new Error("SAML signin did not return a redirect.");
    }

    const ssoUrl = rewriteUrlForHostAccess(signInLocation, zitadelRuntimeBaseUrl, zitadelBaseUrl);
    const ssoResponse = await requestHttp(ssoUrl);
    expect(ssoResponse.status).toBeGreaterThanOrEqual(300);
    expect(ssoResponse.status).toBeLessThan(400);
    const loginLocation = ssoResponse.headers.get("location");
    if (!loginLocation) {
      throw new Error("ZITADEL Connection did not redirect to login UI.");
    }
    samlRequestId = extractSamlRequestIdFromLoginUrl(loginLocation, zitadelBaseUrl);
  } else if (signInResponse.status === 200) {
    const html = await signInResponse.text();
    const { action, fields } = parseSamlPostFormFromHtml(html);
    const ssoUrl = rewriteUrlForHostAccess(action, zitadelRuntimeBaseUrl, zitadelBaseUrl);
    const formBody = buildFormBody(fields);
    const ssoResponse = await requestHttp(ssoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody,
    });
    expect(ssoResponse.status).toBeGreaterThanOrEqual(300);
    expect(ssoResponse.status).toBeLessThan(400);
    const loginLocation = ssoResponse.headers.get("location");
    if (!loginLocation) {
      throw new Error("ZITADEL Connection POST did not redirect to login UI.");
    }
    samlRequestId = extractSamlRequestIdFromLoginUrl(loginLocation, zitadelBaseUrl);
  } else {
    throw new Error(`Unexpected SAML sign-in response status: ${signInResponse.status}`);
  }

  expect(samlRequestId).toBeTruthy();

  const samlRequestDetails = await requestJson<ZitadelSamlRequestDetails>(
    `${zitadelBaseUrl}/v2/saml/saml_requests/${samlRequestId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${loginToken}`,
        "Content-Type": "application/json",
      },
    },
  );
  expect(samlRequestDetails.samlRequest?.id).toBe(samlRequestId);

  const session = await requestJson<ZitadelCreateSessionResponse>(`${zitadelBaseUrl}/v2/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      checks: {
        user: { userId: zitadelUserId },
        password: { password: zitadelUserPassword },
      },
    }),
  });
  const sessionId = session.sessionId ?? session.session_id;
  const sessionToken = session.sessionToken ?? session.session_token;
  expect(sessionId).toBeTruthy();
  expect(sessionToken).toBeTruthy();

  const finalized = await requestJson<ZitadelFinalizeSamlResponse>(
    `${zitadelBaseUrl}/v2/saml/saml_requests/${samlRequestId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${loginToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ session: { sessionId, sessionToken } }),
    },
  );

  expect(finalized.url).toBeTruthy();
  if (!finalized.url) {
    throw new Error("ZITADEL SAML finalization did not return a url.");
  }

  let acsResponse: SimpleResponse;

  const postBinding = finalized.post ?? finalized.binding?.post;

  if (postBinding) {
    const { samlResponse, relayState } = postBinding;
    if (!samlResponse) {
      throw new Error("ZITADEL SAML POST binding did not include samlResponse.");
    }
    const acsUrl = rewriteUrlForHostAccess(finalized.url, zitadelRuntimeBaseUrl, convexSiteUrl);
    const formBody = buildFormBody(
      relayState
        ? { SAMLResponse: samlResponse, RelayState: relayState }
        : { SAMLResponse: samlResponse },
    );
    acsResponse = await requestHttp(acsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader(convexCookies) ?? "",
      },
      body: formBody,
    });
  } else {
    const acsUrl = rewriteUrlForHostAccess(finalized.url, zitadelRuntimeBaseUrl, convexSiteUrl);
    acsResponse = await requestHttp(acsUrl, {
      headers: { Cookie: cookieHeader(convexCookies) ?? "" },
    });
  }

  if (acsResponse.status !== 302) {
    throw new Error(`SAML ACS failed: ${acsResponse.status} ${await acsResponse.text()}`);
  }
  expect(acsResponse.status).toBe(302);
  const completionLocation = acsResponse.headers.get("location");
  if (!completionLocation) {
    throw new Error("Convex SAML ACS did not return a completion redirect.");
  }

  const verificationCode = new URL(completionLocation).searchParams.get("code");
  expect(verificationCode).toBeTruthy();

  const exchanged = (await convexClient.action(api.auth.signIn, {
    request: { params: { code: verificationCode! } },
    verifier,
  })) as ConvexSignInResult;

  expect(exchanged.kind).toBe("signedIn");
  expect(exchanged.session?.token).toBeTruthy();
  expect(exchanged.session?.refreshToken).toBeTruthy();
}, 60_000);
