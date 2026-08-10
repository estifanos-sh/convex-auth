import { components } from "@convex/_generated/api";
import { auth } from "@convex/auth";
import schema from "@convex/schema";
import { getPublicWebhookEndpoint } from "@estifanos-sh/convex-auth/server/connection/webhook";
import { decryptSecret } from "@estifanos-sh/convex-auth/server/secret";
import { expect, test } from "vite-plus/test";

import { convexTest } from "../convex/setup";

test("public webhook projection strips encrypted credential material", () => {
  const endpoint = getPublicWebhookEndpoint({
    _id: "endpoint-id",
    status: "active" as const,
    secretCiphertext: "encrypted-secret",
    subscriptions: ["user.created" as const],
  });

  expect(endpoint).toEqual({
    _id: "endpoint-id",
    status: "active",
    subscriptions: ["user.created"],
  });
  expect(endpoint).not.toHaveProperty("secretCiphertext");
});

test("webhook endpoint update rotates the secret without exposing it", async () => {
  const t = convexTest(schema);

  const groupId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.group.create, {
      name: "Webhook Rotation",
      slug: "webhook-rotation",
      type: "organization",
    });
  });
  const connectionId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.connection.create, {
      groupId,
      slug: "webhook-rotation",
      name: "Webhook Rotation",
      status: "active",
      protocol: "oidc",
    });
  });
  await expect(
    t.run(async (ctx) => {
      return await auth.connection.webhook.endpoint.create(ctx, {
        connectionId,
        url: "https://example.com/webhooks/empty-secret",
        secret: "",
        subscriptions: ["user.created"],
      });
    }),
  ).rejects.toThrow("Webhook secret must not be empty.");
  const { endpointId } = await t.run(async (ctx) => {
    return await auth.connection.webhook.endpoint.create(ctx, {
      connectionId,
      url: "https://example.com/webhooks/rotate",
      secret: "old-secret",
      subscriptions: ["user.created"],
    });
  });

  const before = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.connection.webhook.endpoint.get, {
      id: endpointId,
    });
  });
  await t.run(async (ctx) => {
    await auth.connection.webhook.endpoint.update(ctx, {
      id: endpointId,
      patch: {
        secret: "new-secret",
        status: "active",
        subscriptions: ["user.updated"],
      },
    });
  });
  const raw = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.connection.webhook.endpoint.get, {
      id: endpointId,
    });
  });
  const publicEndpoint = await t.run(async (ctx) => {
    return await auth.connection.webhook.endpoint.get(ctx, { id: endpointId });
  });

  expect(raw?.secretCiphertext).not.toBe(before?.secretCiphertext);
  expect(await decryptSecret(raw!.secretCiphertext)).toBe("new-secret");
  expect(publicEndpoint).not.toHaveProperty("secretCiphertext");
  expect(publicEndpoint?.subscriptions).toEqual(["user.updated"]);
});
