/**
 * The deployment's webhook endpoint at WorkOS: registering and unregistering
 * it, keeping the secret WorkOS signs its deliveries with, and checking that
 * signature. A verified delivery carries nothing the copy applies: it rings
 * the app's action, which pulls.
 *
 * @module
 */
import type { FunctionHandle } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api.ts";
import {
  action,
  env,
  internalMutation,
  internalQuery,
} from "./_generated/server.ts";
import { Workos, WorkosError } from "./workos.ts";

/**
 * A stored handle as the action handle it is. Function handles are strings
 * that Convex brands, and a stored one loses the brand; Convex mints them
 * with this scheme.
 */
export function ringHandle(value: string): FunctionHandle<"action"> {
  if (!isHandle(value)) throw new Error("onRing must be a function handle");
  return value;
}

function isHandle(value: string): value is FunctionHandle<"action"> {
  return value.startsWith("function://");
}

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

/**
 * Where WorkOS delivers this deployment's webhooks: the component's own
 * `/webhook` route. Inside a component, `CONVEX_SITE_URL` already ends with
 * the `httpPrefix` the app installed it under.
 */
function webhookUrl(): string {
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (siteUrl === undefined) {
    throw new Error(
      "CONVEX_SITE_URL is not visible inside the WorkOS component. " +
        "This requires a Convex backend with system env vars in component " +
        "functions.",
    );
  }
  return `${siteUrl}/webhook`;
}

async function find(workos: Workos, url: string) {
  let after: string | undefined;
  do {
    const page = await workos.endpoints(after);
    const found = page.data.find((endpoint) => endpoint.endpoint_url === url);
    if (found !== undefined) return found;
    after = page.after;
  } while (after !== undefined);
  return null;
}

/**
 * Register this deployment's webhook endpoint at WorkOS, subscribed to the
 * events the copy applies, and keep its signing secret and `onRing`, a
 * function handle to the app's action that a verified delivery runs. Run it
 * on every deploy: it finds the endpoint by its URL, so it never creates a
 * second one, and it enables a disabled endpoint and subscribes it to any
 * event it is missing. Until it has run, the webhook refuses every delivery.
 */
export const register = action({
  args: { onRing: v.string() },
  returns: v.object({ endpointId: v.string(), created: v.boolean() }),
  handler: async (ctx, args) => {
    ringHandle(args.onRing);
    const workos = new Workos(env.CLIENT_SECRET);
    const url = webhookUrl();
    const found = await find(workos, url);
    const endpoint =
      found === null ? await workos.create(url) : await workos.enable(found);
    await ctx.runMutation(internal.webhook.keep, {
      endpointId: endpoint.id,
      url,
      secret: endpoint.secret,
      onRing: args.onRing,
    });
    return { endpointId: endpoint.id, created: found === null };
  },
});

/**
 * Delete this deployment's endpoint at WorkOS and forget its secret. Run it
 * before the deployment is deleted, so WorkOS stops delivering to it.
 * Returns whether there was an endpoint to delete.
 */
export const unregister = action({
  args: {},
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx) => {
    const workos = new Workos(env.CLIENT_SECRET);
    const kept = await ctx.runQuery(internal.webhook.read, {});
    const id = kept?.endpointId ?? (await find(workos, webhookUrl()))?.id;
    let deleted = false;
    if (id !== undefined) {
      try {
        await workos.remove(id);
        deleted = true;
      } catch (error) {
        // Already deleted, e.g. in the dashboard.
        if (!(error instanceof WorkosError && error.status === 404)) {
          throw error;
        }
      }
    }
    await ctx.runMutation(internal.webhook.forget, {});
    return { deleted };
  },
});

export const keep = internalMutation({
  args: {
    endpointId: v.string(),
    url: v.string(),
    secret: v.string(),
    onRing: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.query("webhook").first();
    if (row === null) await ctx.db.insert("webhook", args);
    else await ctx.db.replace("webhook", row._id, args);
    return null;
  },
});

export const forget = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const row = await ctx.db.query("webhook").first();
    if (row !== null) await ctx.db.delete("webhook", row._id);
    return null;
  },
});

/** The registered endpoint, or null before `register` ran. */
export const read = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      secret: v.string(),
      onRing: v.string(),
      endpointId: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const row = await ctx.db.query("webhook").first();
    return row === null
      ? null
      : { secret: row.secret, onRing: row.onRing, endpointId: row.endpointId };
  },
});
