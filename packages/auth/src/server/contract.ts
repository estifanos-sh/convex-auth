import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";

import { cached, invalidateCtxCache } from "./cache/context";
import { single } from "./component/api";
import type { ComponentCtx as ComponentWriteCtx, ComponentReadCtx } from "./component/context";
import type { AuthEventKind } from "./events";
import type { ConvexAuthMaterializedConfig } from "./types";

type ComponentConnection = ConvexAuthMaterializedConfig["component"]["connection"];
type ComponentUser = ConvexAuthMaterializedConfig["component"]["user"];

type GroupConnectionRecord = FunctionReturnType<ComponentConnection["list"]>["page"][number];

type PaginatedResult<T> = {
  page: T[];
  isDone: boolean;
  continueCursor: string;
};

type PaginationOpts = {
  numItems: number;
  cursor: string | null;
};

type ConnectionDomainRecord = FunctionReturnType<ComponentConnection["domain"]["list"]>[number];
type ConnectionDomainVerificationRecord = NonNullable<
  FunctionReturnType<ComponentConnection["domain"]["verification"]["get"]>
>;
type ScimConfigRecord = NonNullable<
  FunctionReturnType<ComponentConnection["scim"]["config"]["get"]>
>;
type GroupConnectionSecretRecord = NonNullable<
  FunctionReturnType<ComponentConnection["secret"]["get"]>
>;
type WebhookEndpointRecord = FunctionReturnType<
  ComponentConnection["webhook"]["endpoint"]["list"]
>[number];
type WebhookDeliveryRecord = FunctionReturnType<
  ComponentConnection["webhook"]["delivery"]["list"]
>["page"][number];
type InternalWebhookDeliveryRecord = FunctionReturnType<
  ComponentConnection["webhook"]["delivery"]["dueForDispatch"]
>[number];

export type ScimIdentityRecord = FunctionReturnType<
  ComponentConnection["scim"]["identity"]["list"]
>["page"][number];

const componentQuery = <TArgs extends object, TResult>(
  ctx: ComponentReadCtx,
  ref: FunctionReference<"query", any, any, TResult>,
  args: TArgs,
): Promise<TResult> => ctx.runQuery(ref, args);

const componentMutation = <TArgs extends object, TResult>(
  ctx: ComponentWriteCtx,
  ref: FunctionReference<"mutation", any, any, TResult>,
  args: TArgs,
): Promise<TResult> => ctx.runMutation(ref, args);

export const getGroupConnection = (
  ctx: ComponentReadCtx,
  componentConnection: ComponentConnection,
  connectionId: string,
) =>
  cached(ctx, `group-connection:${connectionId}`, async () => {
    const result = await ctx.runQuery(componentConnection.get, {
      id: connectionId,
    });
    if (result !== null && "connection" in result) {
      throw new TypeError("Component connection lookup returned a domain result for an id lookup.");
    }
    return result;
  });

export const getGroupConnectionByDomain = (
  ctx: ComponentReadCtx,
  componentConnection: ComponentConnection,
  domain: string,
) =>
  cached(ctx, `group-connection-domain:${domain}`, async () => {
    const result = await ctx.runQuery(componentConnection.get, { domain });
    if (result !== null && !("connection" in result)) {
      throw new TypeError("Component connection lookup returned an id result for a domain lookup.");
    }
    return result;
  });

export const listGroupConnections = (
  ctx: ComponentReadCtx,
  componentConnection: ComponentConnection,
  args: {
    where?: {
      groupId?: string;
      slug?: string;
      status?: "draft" | "active" | "disabled";
    };
    paginationOpts: PaginationOpts;
    orderBy?: "_creationTime" | "name" | "slug" | "status";
    order?: "asc" | "desc";
  },
) =>
  componentQuery<typeof args, PaginatedResult<GroupConnectionRecord>>(
    ctx,
    componentConnection.list,
    args,
  );

export const createGroupConnection = (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  args: FunctionArgs<ComponentConnection["create"]>,
) => componentMutation<typeof args, string>(ctx, componentConnection.create, args);

export const updateGroupConnection = async (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  args: {
    connectionId: string;
    patch: FunctionArgs<ComponentConnection["update"]>["patch"];
  },
) => {
  const result = await componentMutation<FunctionArgs<ComponentConnection["update"]>, null>(
    ctx,
    componentConnection.update,
    { id: args.connectionId, patch: args.patch },
  );
  invalidateCtxCache(ctx, `group-connection:${args.connectionId}`);
  invalidateCtxCache(ctx, "group-connection-domain");
  return result;
};

export const removeGroupConnection = async (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  connectionId: string,
) => {
  const result = await componentMutation<{ id: string }, null>(ctx, componentConnection.remove, {
    id: connectionId,
  });
  invalidateCtxCache(ctx, `group-connection:${connectionId}`);
  invalidateCtxCache(ctx, "group-connection-domain");
  invalidateCtxCache(ctx, `connection-domains:${connectionId}`);
  invalidateCtxCache(ctx, "group-connection-secret");
  return result;
};

export const getGroup = (
  ctx: ComponentReadCtx,
  componentGroup: ConvexAuthMaterializedConfig["component"]["group"],
  groupId: string,
) =>
  cached(ctx, `group-record:${groupId}`, async () =>
    single(await ctx.runQuery(componentGroup.get, { id: groupId })),
  );

export const listConnectionDomains = (
  ctx: ComponentReadCtx,
  componentConnection: ComponentConnection,
  connectionId: string,
) =>
  cached(ctx, `connection-domains:${connectionId}`, () =>
    componentQuery<{ connectionId: string }, ConnectionDomainRecord[]>(
      ctx,
      componentConnection.domain.list,
      { connectionId },
    ),
  );

export const createConnectionDomain = async (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  args: {
    connectionId: string;
    groupId: string;
    domain: string;
    isPrimary?: boolean;
  },
) => {
  const result = await componentMutation<typeof args, string>(
    ctx,
    componentConnection.domain.create,
    args,
  );
  invalidateCtxCache(ctx, `connection-domains:${args.connectionId}`);
  invalidateCtxCache(ctx, "group-connection-domain");
  return result;
};

export const removeConnectionDomain = async (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  domainId: string,
) => {
  const result = await componentMutation<{ id: string }, null>(
    ctx,
    componentConnection.domain.remove,
    {
      id: domainId,
    },
  );
  invalidateCtxCache(ctx, "connection-domains");
  invalidateCtxCache(ctx, "group-connection-domain");
  return result;
};

export const getScimConfigByConnection = (
  ctx: ComponentReadCtx,
  componentConnection: ComponentConnection,
  connectionId: string,
) =>
  cached(ctx, `scim-config-by-connection:${connectionId}`, () =>
    componentQuery<{ connectionId: string }, ScimConfigRecord | null>(
      ctx,
      componentConnection.scim.config.get,
      { connectionId },
    ),
  );

export const getScimConfigByTokenHash = (
  ctx: ComponentReadCtx,
  componentConnection: ComponentConnection,
  tokenHash: string,
) =>
  componentQuery<{ tokenHash: string }, ScimConfigRecord | null>(
    ctx,
    componentConnection.scim.config.get,
    { tokenHash },
  );

export const upsertScimConfig = async (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  args: {
    connectionId: string;
    groupId: string;
    status: string;
    basePath: string;
    tokenHash: string;
    lastRotatedAt?: number;
    extend?: unknown;
  },
) => {
  const result = await componentMutation<typeof args, string>(
    ctx,
    componentConnection.scim.config.upsert,
    args,
  );
  invalidateCtxCache(ctx, `scim-config-by-connection:${args.connectionId}`);
  return result;
};

export const getConnectionDomainVerification = (
  ctx: ComponentReadCtx,
  componentConnection: ComponentConnection,
  domainId: string,
) =>
  componentQuery<{ domainId: string }, ConnectionDomainVerificationRecord | null>(
    ctx,
    componentConnection.domain.verification.get,
    { domainId },
  );

export const upsertConnectionDomainVerification = (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  args: {
    connectionId: string;
    groupId: string;
    domainId: string;
    domain: string;
    recordName: string;
    token: string;
    tokenHash: string;
    requestedAt: number;
    expiresAt: number;
  },
) =>
  componentMutation<typeof args, string>(ctx, componentConnection.domain.verification.upsert, args);

export const removeConnectionDomainVerification = (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  domainId: string,
) =>
  componentMutation<{ domainId: string }, null>(
    ctx,
    componentConnection.domain.verification.remove,
    {
      domainId,
    },
  );

export const verifyConnectionDomain = (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  args: { domainId: string; verifiedAt: number },
) =>
  componentMutation<{ id: string; verifiedAt: number }, ConnectionDomainRecord>(
    ctx,
    componentConnection.domain.verify,
    {
      id: args.domainId,
      verifiedAt: args.verifiedAt,
    },
  );

export const getGroupConnectionSecret = (
  ctx: ComponentReadCtx,
  componentConnection: ComponentConnection,
  args: { connectionId: string; kind: string },
) =>
  cached(ctx, `group-connection-secret:${args.connectionId}:${args.kind}`, () =>
    componentQuery<typeof args, GroupConnectionSecretRecord | null>(
      ctx,
      componentConnection.secret.get,
      args,
    ),
  );

export const upsertGroupConnectionSecret = async (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  args: {
    connectionId: string;
    groupId: string;
    kind: string;
    ciphertext: string;
    updatedAt: number;
  },
) => {
  const result = await componentMutation<typeof args, string>(
    ctx,
    componentConnection.secret.upsert,
    args,
  );
  invalidateCtxCache(ctx, `group-connection-secret:${args.connectionId}:${args.kind}`);
  return result;
};

export const listWebhookEndpoints = (
  ctx: ComponentReadCtx,
  componentConnection: ComponentConnection,
  connectionId: string,
) =>
  componentQuery<{ connectionId: string }, WebhookEndpointRecord[]>(
    ctx,
    componentConnection.webhook.endpoint.list,
    { connectionId },
  );

export const listWebhookDeliveries = (
  ctx: ComponentReadCtx,
  componentConnection: ComponentConnection,
  args: {
    connectionId: string;
    paginationOpts: PaginationOpts;
  },
) =>
  componentQuery<typeof args, PaginatedResult<WebhookDeliveryRecord>>(
    ctx,
    componentConnection.webhook.delivery.list,
    args,
  );

/** Upper bound on SCIM identities materialized into the per-connection lookup map. */
const SCIM_IDENTITY_COLLECT_LIMIT = 10_000;

export const listScimIdentitiesByConnection = async (
  ctx: ComponentReadCtx,
  componentConnection: ComponentConnection,
  connectionId: string,
): Promise<ScimIdentityRecord[]> => {
  const identities: ScimIdentityRecord[] = [];
  let cursor: string | null = null;
  for (;;) {
    const result: PaginatedResult<ScimIdentityRecord> = await componentQuery<
      { connectionId: string; paginationOpts: PaginationOpts },
      PaginatedResult<ScimIdentityRecord>
    >(ctx, componentConnection.scim.identity.list, {
      connectionId,
      paginationOpts: { numItems: 200, cursor },
    });
    identities.push(...result.page);
    if (result.isDone || identities.length >= SCIM_IDENTITY_COLLECT_LIMIT) break;
    cursor = result.continueCursor;
  }
  return identities;
};

export const getScimIdentityByConnectionAndUser = (
  ctx: ComponentReadCtx,
  componentConnection: ComponentConnection,
  args: { connectionId: string; userId: string },
) => ctx.runQuery(componentConnection.scim.identity.get, args).then(single);

export const getScimIdentityByMappedGroup = (
  ctx: ComponentReadCtx,
  componentConnection: ComponentConnection,
  mappedGroupId: string,
) => ctx.runQuery(componentConnection.scim.identity.get, { mappedGroupId }).then(single);

export const provisionScimUser = (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  args: FunctionArgs<ComponentConnection["scim"]["identity"]["provision"]>,
) =>
  componentMutation<typeof args, { userId: string; created: boolean }>(
    ctx,
    componentConnection.scim.identity.provision,
    args,
  );

export const updateScimUser = (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  args: FunctionArgs<ComponentConnection["scim"]["identity"]["update"]>,
) => componentMutation<typeof args, null>(ctx, componentConnection.scim.identity.update, args);

export const revokeScimUser = (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  args: FunctionArgs<ComponentConnection["scim"]["identity"]["revoke"]>,
) =>
  componentMutation<
    typeof args,
    { epoch: number; cleanedSessions: number; cleanupPending: boolean }
  >(ctx, componentConnection.scim.identity.revoke, args);

export const provisionScimGroup = (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  args: FunctionArgs<ComponentConnection["scim"]["identity"]["provisionGroup"]>,
) =>
  componentMutation<typeof args, { groupId: string; created: boolean }>(
    ctx,
    componentConnection.scim.identity.provisionGroup,
    args,
  );

export const updateScimGroup = (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  args: FunctionArgs<ComponentConnection["scim"]["identity"]["updateGroup"]>,
) => componentMutation<typeof args, null>(ctx, componentConnection.scim.identity.updateGroup, args);

export const revokeScimGroup = (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  args: FunctionArgs<ComponentConnection["scim"]["identity"]["revokeGroup"]>,
) => componentMutation<typeof args, null>(ctx, componentConnection.scim.identity.revokeGroup, args);

export const insertUser = (
  ctx: ComponentWriteCtx,
  componentUser: ComponentUser,
  data: FunctionArgs<ComponentUser["create"]>["data"],
) =>
  componentMutation<FunctionArgs<ComponentUser["create"]>, string>(ctx, componentUser.create, {
    data,
  });

export const updateUser = (
  ctx: ComponentWriteCtx,
  componentUser: ComponentUser,
  args: { userId: string; patch: FunctionArgs<ComponentUser["update"]>["patch"] },
) =>
  componentMutation<FunctionArgs<ComponentUser["update"]>, null>(ctx, componentUser.update, {
    id: args.userId,
    patch: args.patch,
  });

export const getScimIdentity = (
  ctx: ComponentReadCtx,
  componentConnection: ComponentConnection,
  args: {
    connectionId: string;
    resourceType: "user" | "group";
    externalId: string;
  },
) => ctx.runQuery(componentConnection.scim.identity.get, args).then(single);

export const getWebhookEndpoint = (
  ctx: ComponentReadCtx,
  componentConnection: ComponentConnection,
  endpointId: string,
) =>
  componentQuery<{ id: string }, WebhookEndpointRecord | null>(
    ctx,
    componentConnection.webhook.endpoint.get,
    {
      id: endpointId,
    },
  );

export const createWebhookEndpoint = (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  args: {
    connectionId: string;
    groupId: string;
    url: string;
    secretCiphertext: string;
    subscriptions: AuthEventKind[];
    createdByUserId?: string;
  },
) => componentMutation<typeof args, string>(ctx, componentConnection.webhook.endpoint.create, args);

export const updateWebhookEndpoint = (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  args: {
    endpointId: string;
    patch: FunctionArgs<ComponentConnection["webhook"]["endpoint"]["update"]>["patch"];
  },
) =>
  componentMutation<FunctionArgs<ComponentConnection["webhook"]["endpoint"]["update"]>, null>(
    ctx,
    componentConnection.webhook.endpoint.update,
    { id: args.endpointId, patch: args.patch },
  );

export const listReadyWebhookDeliveries = (
  ctx: ComponentReadCtx,
  componentConnection: ComponentConnection,
  args: { now: number; limit?: number },
) =>
  componentQuery<typeof args, InternalWebhookDeliveryRecord[]>(
    ctx,
    componentConnection.webhook.delivery.dueForDispatch,
    args,
  );

export const updateWebhookDelivery = (
  ctx: ComponentWriteCtx,
  componentConnection: ComponentConnection,
  args: {
    deliveryId: string;
    patch: FunctionArgs<ComponentConnection["webhook"]["delivery"]["update"]>["patch"];
  },
) =>
  componentMutation<FunctionArgs<ComponentConnection["webhook"]["delivery"]["update"]>, null>(
    ctx,
    componentConnection.webhook.delivery.update,
    { id: args.deliveryId, patch: args.patch },
  );
