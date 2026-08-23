/**
 * RFC 6749 error responses for the OAuth wire endpoints.
 *
 * @module
 */

/**
 * Build an OAuth error response.
 *
 * `Cache-Control: no-store` is not optional decoration. RFC 6749 §5.1 requires
 * it on token responses, and an OAuth error can carry a code, a client id, or
 * enough of a description to be worth withholding from a shared cache. Three
 * endpoints previously built this response independently and one of them left
 * the header off, which is exactly the failure a shared helper prevents.
 *
 * `extraHeaders` covers the one legitimate variation: a `401 invalid_client`
 * from the token endpoint also carries a `WWW-Authenticate` challenge.
 *
 * @internal
 */
export function jsonError(
  status: number,
  error: string,
  description: string,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}
