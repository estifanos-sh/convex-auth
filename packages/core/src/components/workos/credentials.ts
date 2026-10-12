/**
 * The WorkOS credentials the component is bound to.
 *
 * @module
 */
import { ConvexError, Infer, v } from "convex/values";

/** What the component is bound to, by fingerprint, never the secret. */
export const vBoundCredentials = v.object({
  apiKey: v.union(v.string(), v.null()),
  clientId: v.union(v.string(), v.null()),
});
export type BoundCredentials = Infer<typeof vBoundCredentials>;

async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function required(name: "CLIENT_ID" | "CLIENT_SECRET"): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new ConvexError({
      code: "WORKOS_NOT_CONFIGURED",
      message: `${name} is not bound to the WorkOS component`,
      status: 500,
    });
  }
  return value;
}

/**
 * The bound client ID and API key, read at call time: a key rotated in the
 * dashboard reaches the next sync without a redeploy, which is how a sync
 * stopped on a refused key resumes.
 */
export class Credentials {
  private constructor(
    readonly apiKey: string,
    readonly clientId: string,
  ) {}

  static read(): Credentials {
    return new Credentials(required("CLIENT_SECRET"), required("CLIENT_ID"));
  }

  static async report(): Promise<BoundCredentials> {
    const apiKey = process.env.CLIENT_SECRET;
    return {
      apiKey: apiKey ? await fingerprint(apiKey) : null,
      clientId: process.env.CLIENT_ID || null,
    };
  }

  async fingerprint(): Promise<string> {
    return await fingerprint(this.apiKey);
  }
}
