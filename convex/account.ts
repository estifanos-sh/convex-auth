import { ConvexError, v, type GenericId } from "convex/values";

import { auth } from "./auth";
import { vAuthApiKeyId } from "./auth/ids";
import { ErrorCode } from "./errors";
import { authUserMutation, authUserQuery } from "./functions";

const vPasskey = v.object({
  passkeyId: v.string(),
  name: v.union(v.string(), v.null()),
  deviceType: v.string(),
  backedUp: v.boolean(),
  createdAt: v.number(),
  lastUsedAt: v.union(v.number(), v.null()),
});

const vApiKeyScope = v.object({
  resource: v.string(),
  actions: v.array(v.string()),
});

const vApiKey = v.object({
  keyId: vAuthApiKeyId,
  prefix: v.string(),
  name: v.string(),
  revoked: v.boolean(),
  createdAt: v.number(),
  lastUsedAt: v.union(v.number(), v.null()),
  scopes: v.array(vApiKeyScope),
});

type ApiKeyGetCtx = Parameters<typeof auth.key.get>[0];

async function requireOwnedApiKey(
  ctx: ApiKeyGetCtx,
  userId: GenericId<"User">,
  keyId: GenericId<"ApiKey">,
) {
  const key = await auth.key.get(ctx, { id: keyId });
  if (!key || key.userId !== userId) {
    throw new ConvexError({
      code: ErrorCode.NOT_FOUND,
      message: "API key not found.",
    });
  }
  return key;
}

export const listPasskeys = authUserQuery({
  args: {},
  returns: v.array(vPasskey),
  handler: async (ctx) => {
    const passkeys = (await auth.factor.list(ctx)).filter((factor) => factor.kind === "webauthn");
    return passkeys.map((passkey) => ({
      passkeyId: passkey.id,
      name: passkey.name,
      deviceType: passkey.deviceType,
      backedUp: passkey.backedUp,
      createdAt: passkey.createdAt,
      lastUsedAt: passkey.lastUsedAt ?? null,
    }));
  },
});

export const renamePasskey = authUserMutation({
  args: { passkeyId: v.string(), name: v.string() },
  returns: v.object({ passkeyId: v.string() }),
  handler: async (ctx, args) => {
    await auth.factor.update(ctx, {
      kind: "webauthn",
      id: args.passkeyId,
      patch: { name: args.name.trim() },
    });
    return { passkeyId: args.passkeyId };
  },
});

export const removePasskey = authUserMutation({
  args: { passkeyId: v.string() },
  returns: v.object({ passkeyId: v.string() }),
  handler: async (ctx, args) => {
    await auth.factor.remove(ctx, { kind: "webauthn", id: args.passkeyId });
    return { passkeyId: args.passkeyId };
  },
});

export const listApiKeys = authUserQuery({
  args: {},
  returns: v.array(vApiKey),
  handler: async (ctx) => {
    const userId = ctx.auth.userId;
    const result = await auth.key.list(ctx, {
      where: { userId },
      paginationOpts: { numItems: 20, cursor: null },
      orderBy: "lastUsedAt",
      order: "desc",
    });
    return result.page.map((key) => ({
      keyId: key._id,
      prefix: key.prefix,
      name: key.name,
      revoked: key.revoked,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt ?? null,
      scopes: key.scopes,
    }));
  },
});

export const createApiKey = authUserMutation({
  args: {
    name: v.string(),
    issueRead: v.boolean(),
    issueWrite: v.boolean(),
  },
  returns: v.object({ keyId: vAuthApiKeyId, secret: v.string() }),
  handler: async (ctx, args) => {
    const userId = ctx.auth.userId;
    const scopeActions = [
      ...(args.issueRead ? ["read"] : []),
      ...(args.issueWrite ? ["write"] : []),
    ];
    const scopes = scopeActions.length === 0 ? [] : [{ resource: "issues", actions: scopeActions }];
    const result = await auth.key.create(ctx, {
      data: {
        userId,
        name: args.name.trim(),
        scopes,
      },
    });
    return { keyId: result.id, secret: result.secret };
  },
});

export const revokeApiKey = authUserMutation({
  args: { keyId: vAuthApiKeyId },
  returns: v.object({ keyId: vAuthApiKeyId }),
  handler: async (ctx, args) => {
    const userId = ctx.auth.userId;
    await requireOwnedApiKey(ctx, userId, args.keyId);
    await auth.key.revoke(ctx, { id: args.keyId });
    return { keyId: args.keyId };
  },
});

export const hasPassword = authUserQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const accounts = await auth.account.list(ctx);
    return accounts.some((account) => account.provider === "password");
  },
});
