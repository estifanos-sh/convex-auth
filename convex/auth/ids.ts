import { vAuthId } from "@estifanos-sh/convex-auth/server";
import type { GenericId } from "convex/values";

export type AuthUserId = GenericId<"User">;
export type AuthGroupId = GenericId<"Group">;
export type AuthGroupMemberId = GenericId<"GroupMember">;
export type AuthGroupInviteId = GenericId<"GroupInvite">;
export type AuthApiKeyId = GenericId<"ApiKey">;
export type AuthGroupConnectionId = GenericId<"GroupConnection">;
export type AuthGroupWebhookEndpointId = GenericId<"GroupWebhookEndpoint">;
export type AuthGroupWebhookDeliveryId = GenericId<"GroupWebhookDelivery">;
export type AuthGroupConnectionScimConfigId = GenericId<"GroupConnectionScimConfig">;

export const vAuthUserId = vAuthId("User");
export const vAuthGroupId = vAuthId("Group");
export const vAuthGroupMemberId = vAuthId("GroupMember");
export const vAuthGroupInviteId = vAuthId("GroupInvite");
export const vAuthApiKeyId = vAuthId("ApiKey");
export const vAuthGroupConnectionId = vAuthId("GroupConnection");
export const vAuthGroupWebhookEndpointId = vAuthId("GroupWebhookEndpoint");
export const vAuthGroupWebhookDeliveryId = vAuthId("GroupWebhookDelivery");
export const vAuthGroupConnectionScimConfigId = vAuthId("GroupConnectionScimConfig");
