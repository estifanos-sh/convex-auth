import type { Auth } from "convex/server";
import { ConvexError, type GenericId } from "convex/values";

import { ErrorCode } from "../../shared/codes";
import type { ComponentCtx, ComponentReadCtx } from "../component/context";
import { configDefaults } from "../config";
import { getSessionUserId } from "../context";
import { emitAuthEvent } from "../events";
import type { Doc } from "../types";

export type FactorSummary =
  | {
      kind: "webauthn";
      id: GenericId<"Passkey">;
      name: string | null;
      createdAt: number;
      lastUsedAt: number | null;
      deviceType: string;
      backedUp: boolean;
      transports: string[];
      attestation: Doc<"Passkey">["attestation"] | null;
    }
  | {
      kind: "totp";
      id: GenericId<"TotpFactor">;
      name: string | null;
      createdAt: number;
      lastUsedAt: number | null;
      verified: boolean;
    };

export type FactorKind = FactorSummary["kind"];

type FactorReadCtx = ComponentReadCtx & { auth: Auth };
type FactorWriteCtx = ComponentCtx & { auth: Auth };

export type FactorDeps = { config: ReturnType<typeof configDefaults> };

async function currentUserId(ctx: FactorReadCtx): Promise<GenericId<"User">> {
  const userId = await getSessionUserId(ctx);
  if (userId === null) {
    throw new ConvexError({
      code: ErrorCode.NOT_SIGNED_IN,
      message: "Authentication required.",
    });
  }
  return userId as GenericId<"User">;
}

/** Build the safe, current-user factor-management surface. */
export function createFactorDomain({ config }: FactorDeps) {
  return {
    /** List bounded factor summaries without credential secrets or public keys. */
    list: async (ctx: FactorReadCtx): Promise<FactorSummary[]> => {
      const userId = await currentUserId(ctx);
      const [passkeys, totps] = (await Promise.all([
        ctx.runQuery(config.component.factor.passkey.list, { userId }),
        ctx.runQuery(config.component.factor.totp.list, { userId }),
      ])) as [Doc<"Passkey">[], Doc<"TotpFactor">[]];
      return [
        ...passkeys.map(
          (factor): FactorSummary => ({
            kind: "webauthn",
            id: factor._id,
            name: factor.name ?? null,
            createdAt: factor.createdAt,
            lastUsedAt: factor.lastUsedAt ?? null,
            deviceType: factor.deviceType,
            backedUp: factor.backedUp,
            transports: factor.transports ?? [],
            attestation: factor.attestation ?? null,
          }),
        ),
        ...totps.map(
          (factor): FactorSummary => ({
            kind: "totp",
            id: factor._id,
            name: factor.name ?? null,
            createdAt: factor.createdAt,
            lastUsedAt: factor.lastUsedAt ?? null,
            verified: factor.verified,
          }),
        ),
      ].sort((a, b) => b.createdAt - a.createdAt);
    },

    /** Rename a factor owned by the current user. */
    update: async (
      ctx: FactorWriteCtx,
      args: { kind: FactorKind; id: string; patch: { name: string } },
    ): Promise<{ id: string; kind: FactorKind }> => {
      const userId = await currentUserId(ctx);
      if (args.kind === "webauthn") {
        await ctx.runMutation(config.component.factor.passkey.update, {
          id: args.id,
          userId,
          patch: { name: args.patch.name },
        });
      } else {
        await ctx.runMutation(config.component.factor.totp.update, {
          id: args.id,
          userId,
          patch: { name: args.patch.name },
        });
      }
      return { id: args.id, kind: args.kind };
    },

    /** Remove a factor owned by the current user and append its audit event. */
    remove: async (
      ctx: FactorWriteCtx,
      args: { kind: FactorKind; id: string },
    ): Promise<{ id: string; kind: FactorKind }> => {
      const userId = await currentUserId(ctx);
      if (args.kind === "webauthn") {
        await ctx.runMutation(config.component.factor.passkey.remove, {
          id: args.id,
          userId,
          requireOtherAccount: true,
        });
        await emitAuthEvent(ctx, config, {
          kind: "passkey.removed",
          actor: { type: "user", id: userId },
          subject: { type: "passkey", id: args.id },
          targets: [{ kind: "user", id: userId }],
          outcome: "success",
          data: { passkeyId: args.id },
        });
      } else {
        await ctx.runMutation(config.component.factor.totp.remove, {
          id: args.id,
          userId,
        });
        await emitAuthEvent(ctx, config, {
          kind: "totp.removed",
          actor: { type: "user", id: userId },
          subject: { type: "totp", id: args.id },
          targets: [{ kind: "user", id: userId }],
          outcome: "success",
          data: { totpId: args.id },
        });
      }
      return { id: args.id, kind: args.kind };
    },
  };
}
