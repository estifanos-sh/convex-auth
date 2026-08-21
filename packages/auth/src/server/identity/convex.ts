import type { GenericId } from "convex/values";

declare module "convex/server" {
  interface UserIdentity {
    /**
     * Current session id issued by convex-auth.
     *
     * This is a custom JWT claim mirrored into Convex's identity object so
     * native identity access can read `identity.sid` directly.
     */
    readonly sid?: GenericId<"Session">;
    /** Session epoch captured in the convex-auth access token. */
    readonly session_epoch?: number;
  }
}
