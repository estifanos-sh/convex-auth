/**
 * Ending a user's WorkOS sessions.
 *
 * Signing out of the app ends its Convex Auth session only; the user's
 * WorkOS session stays, so a later sign-in goes through without asking again.
 * Revoking ends every WorkOS session of the user, on every device.
 *
 * @module
 */
import { v } from "convex/values";
import { Credentials } from "./credentials.ts";
import { decodeList, matches } from "./wire.ts";
import { Api } from "./workosApi.ts";
import { action } from "./_generated/server.ts";

const vSession = v.object({ id: v.string(), status: v.optional(v.string()) });

/**
 * Revoke every active WorkOS session of a WorkOS user (`user_...`), and
 * return how many there were. It returns only once WorkOS has revoked them
 * all, and throws if WorkOS refuses or can't be reached, so a caller that
 * goes on to sign the user out knows their WorkOS sessions are gone. The app
 * decides who may do this, and resolves the user from its own records.
 */
export const revoke = action({
  args: { user: v.string() },
  returns: v.number(),
  handler: async (_ctx, args) => {
    const api = new Api(Credentials.read());
    const path = `/user_management/users/${encodeURIComponent(args.user)}/sessions`;
    const sessions: string[] = [];
    let after: string | null = null;
    do {
      const reply = await api.get(path, {
        limit: "100",
        after: after ?? undefined,
      });
      const list = decodeList(reply.body);
      for (const item of list.items) {
        if (!matches(vSession, item)) continue;
        const session = item as { id: string; status?: string };
        if (session.status === undefined || session.status === "active") {
          sessions.push(session.id);
        }
      }
      after = list.after;
    } while (after !== null);
    for (const session of sessions) {
      await api.send("POST", "/user_management/sessions/revoke", {
        session_id: session,
      });
    }
    return sessions.length;
  },
});
