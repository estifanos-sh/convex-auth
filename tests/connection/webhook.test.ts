import { components } from "@convex/_generated/api";
import { auth } from "@convex/auth";
import schema from "@convex/schema";
import { getPublicWebhookEndpoint } from "@estifanos-sh/convex-auth/server/connection/webhook";
import { decryptSecret } from "@estifanos-sh/convex-auth/server/secret";
import { expect, test } from "vite-plus/test";

import { convexTest, privateAuthForTest } from "../convex/setup";

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

test("webhook delivery state transitions commit matching audit events", async () => {
  const t = convexTest(schema);
  const groupId = await t.run(
    async (ctx) =>
      await ctx.runMutation(components.auth.group.create, {
        name: "Webhook audit",
        slug: "webhook-audit",
        type: "organization",
      }),
  );
  const connectionId = await t.run(
    async (ctx) =>
      await ctx.runMutation(components.auth.connection.create, {
        groupId,
        slug: "webhook-audit",
        name: "Webhook audit",
        status: "active",
        protocol: "oidc",
      }),
  );
  const endpointId = await t.run(
    async (ctx) =>
      await ctx.runMutation(components.auth.connection.webhook.endpoint.create, {
        connectionId,
        groupId,
        url: "https://example.com/webhooks/audit",
        secretCiphertext: "encrypted",
        subscriptions: ["user.created"],
      }),
  );
  const now = Date.now();
  const deliveryId = await t.run(
    async (ctx) =>
      await ctx.runMutation(components.auth.connection.webhook.delivery.create, {
        connectionId,
        endpointId,
        eventId: "source-event",
        kind: "user.created",
        payload: { userId: "user" },
        nextAttemptAt: now,
        signature: "signature",
        signedAt: now,
      }),
  );
  const begun = await t.run(
    async (ctx) =>
      await ctx.runMutation(privateAuthForTest(components.auth).connection.webhook.delivery.begin, {
        id: deliveryId,
        occurredAt: now + 1,
      }),
  );
  expect(begun?.status).toBe("processing");
  expect(begun?.attemptCount).toBe(1);
  await t.run(
    async (ctx) =>
      await ctx.runMutation(
        privateAuthForTest(components.auth).connection.webhook.delivery.settle,
        {
          id: deliveryId,
          occurredAt: now + 2,
          outcome: "success",
          retry: false,
          responseStatus: 204,
        },
      ),
  );

  const delivery = await t.run(
    async (ctx) =>
      await ctx.runQuery(components.auth.connection.webhook.delivery.list, {
        connectionId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
  );
  const audit = await t.run(
    async (ctx) =>
      await ctx.runQuery(components.auth.connection.audit.list, {
        connectionId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
  );
  expect(delivery.page.find(({ _id }) => _id === deliveryId)?.status).toBe("delivered");
  expect(audit.page.map((event) => event.kind)).toEqual(
    expect.arrayContaining([
      "webhook.delivery.created",
      "webhook.delivery.attempted",
      "webhook.delivery.succeeded",
    ]),
  );
});
