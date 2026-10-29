/**
 * Checking the signature WorkOS puts on a webhook.
 *
 * @module
 */

/** How old a signed timestamp may be, against replays. */
const TOLERANCE_MS = 5 * 60 * 1000;

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Compare in time independent of where the strings first differ. */
function equalInConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

/**
 * Whether `header`, WorkOS's `WorkOS-Signature` header of the form
 * `t=<ms>, v1=<hex>`, signs `body` with `secret`: v1 is the HMAC-SHA256 of
 * `<t>.<body>`, and `t` must be recent.
 */
export async function verifyWebhookSignature(args: {
  header: string | null;
  body: string;
  secret: string;
  now: number;
}): Promise<boolean> {
  if (args.header === null) return false;
  const parts = new Map(
    args.header.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")] as const;
    }),
  );
  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (timestamp === undefined || signature === undefined) return false;
  const signedAt = Number(timestamp);
  if (
    !Number.isFinite(signedAt) ||
    Math.abs(args.now - signedAt) > TOLERANCE_MS
  ) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(args.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${args.body}`),
    ),
  );
  return equalInConstantTime(expected, signature.toLowerCase());
}
