import { base64urlDecode, createBrowserRuntime } from "@estifanos-sh/convex-auth/browser/runtime";
import { localMutex } from "@estifanos-sh/convex-auth/client/runtime/mutex";
import { parseRefreshToken } from "@estifanos-sh/convex-auth/server/token/refresh";
import { createOAuthClient } from "@estifanos-sh/convex-auth/server/oauth/factory";
import {
  createSamlPostBindingResponse,
  parseSamlIdpMetadata,
} from "@estifanos-sh/convex-auth/server/connection/saml";
import { expect, test, vi } from "vite-plus/test";

test("refresh token parser rejects extra separators", () => {
  expect(() => parseRefreshToken("refresh|session|extra")).toThrow("INVALID_REFRESH_TOKEN");
});

test("base64urlDecode accepts unpadded values", () => {
  const decoded = base64urlDecode("YQ");
  expect(new TextDecoder().decode(decoded)).toBe("a");
});

test("localMutex continues queue after callback failure", async () => {
  const order: string[] = [];
  await Promise.all([
    localMutex("auth-internals", async () => {
      order.push("first");
      throw new Error("boom");
    }).catch(() => null),
    localMutex("auth-internals", async () => {
      order.push("second");
    }),
  ]);
  expect(order).toEqual(["first", "second"]);
});

test("browser proxy fetch fails clearly outside browser runtime", async () => {
  await expect(createBrowserRuntime().proxy?.fetch({}, "/auth")).rejects.toThrow(
    "Browser proxy fetch is unavailable outside the browser runtime.",
  );
});

test("SAML POST binding response escapes HTML attributes", async () => {
  const response = createSamlPostBindingResponse({
    endpoint: 'https://idp.example/connection?x="y"',
    parameter: "SAMLRequest",
    value: '<xml value="bad">',
    relayState: 'relay"state',
  });
  const html = await response.text();
  expect(html).toContain('action="https://idp.example/connection?x=&quot;y&quot;"');
  expect(html).toContain('value="&lt;xml value=&quot;bad&quot;&gt;"');
  expect(html).toContain('value="relay&quot;state"');
});

test("SAML metadata rejects DTD and entity declarations", () => {
  expect(() =>
    parseSamlIdpMetadata('<!DOCTYPE foo [<!ENTITY xxe "x">]><EntityDescriptor entityID="id" />'),
  ).toThrow("SAML metadata must not contain DTD or entity declarations.");
});

test("optional PKCE clients pass verifier through", async () => {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ access_token: "access" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = createOAuthClient({
    clientId: "client-id",
    redirectUri: () => "https://app.example/callback",
    authorizationUrl: "https://idp.example/authorize",
    tokenUrl: "https://idp.example/token",
    pkce: "optional",
    tokenAuth: "none",
  });

  const url = client.createAuthorizationURL({
    state: "state",
    codeVerifier: "verifier",
    scopes: ["openid"],
  });
  await client.validateAuthorizationCode({ code: "code", codeVerifier: "verifier" });

  expect(url.searchParams.get("code_challenge")).toBeTruthy();
  const body = fetchMock.mock.calls[0]![1]!.body as URLSearchParams;
  expect(body.get("code_verifier")).toBe("verifier");
  vi.unstubAllGlobals();
});
