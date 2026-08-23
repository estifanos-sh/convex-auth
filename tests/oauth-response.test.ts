import { jsonError } from "@estifanos-sh/convex-auth/server/oauth/response";
import { expect, test } from "vite-plus/test";

// RFC 6749 §5.1 requires `no-store` on OAuth responses, and an OAuth error can
// carry a code, a client id, or a description worth withholding from a shared
// cache. Three endpoints built this response independently and one shipped
// without the header, so pin it on the one helper they now share.
test("every OAuth error response is no-store", () => {
  const response = jsonError(400, "invalid_request", "Invalid redirect_uri.");

  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Content-Type")).toBe("application/json");
  expect(response.status).toBe(400);
});

test("extra headers ride alongside without displacing no-store", () => {
  const response = jsonError(401, "invalid_client", "Unknown client.", {
    "WWW-Authenticate": 'Basic realm="token"',
  });

  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("WWW-Authenticate")).toBe('Basic realm="token"');
});

test("the body is the RFC 6749 error shape", async () => {
  const response = jsonError(400, "invalid_request", "Missing required parameter.");

  expect(await response.json()).toEqual({
    error: "invalid_request",
    error_description: "Missing required parameter.",
  });
});
