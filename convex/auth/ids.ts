import { createAuthValidators } from "@estifanos-sh/convex-auth/server";
import type { GenericId } from "convex/values";

const { id } = createAuthValidators();

export type AuthUserId = GenericId<"User">;
export type AuthGroupId = GenericId<"Group">;
export type AuthGroupMemberId = GenericId<"GroupMember">;
export type AuthGroupInviteId = GenericId<"GroupInvite">;
export type AuthApiKeyId = GenericId<"ApiKey">;
export type AuthGroupConnectionId = GenericId<"GroupConnection">;
export type AuthGroupWebhookEndpointId = GenericId<"GroupWebhookEndpoint">;
export type AuthGroupWebhookDeliveryId = GenericId<"GroupWebhookDelivery">;
export type AuthGroupConnectionScimConfigId = GenericId<"GroupConnectionScimConfig">;

export const vAuthUserId = id("User");
export const vAuthGroupId = id("Group");
export const vAuthGroupMemberId = id("GroupMember");
export const vAuthGroupInviteId = id("GroupInvite");
export const vAuthApiKeyId = id("ApiKey");
export const vAuthGroupConnectionId = id("GroupConnection");
export const vAuthGroupWebhookEndpointId = id("GroupWebhookEndpoint");
export const vAuthGroupWebhookDeliveryId = id("GroupWebhookDelivery");
export const vAuthGroupConnectionScimConfigId = id("GroupConnectionScimConfig");
