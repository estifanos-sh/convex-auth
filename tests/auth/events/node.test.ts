import { expect, test, vi } from "vite-plus/test";

import { queueAuthEvent } from "../../../packages/auth/src/server/events";

const eventInput = {
  kind: "session.signed_in" as const,
  actor: { type: "user" as const, id: "user-1" },
  subject: { type: "session" as const, id: "session-1" },
  targets: [
    { kind: "user" as const, id: "user-1" },
    { kind: "session" as const, id: "session-1" },
  ],
  outcome: "success" as const,
  data: { provider: "session" },
};

test("internal auth events schedule durable persistence when no handler is configured", async () => {
  const runMutation = vi.fn();
  const runAfter = vi.fn().mockResolvedValue("scheduled-id");

  await queueAuthEvent(
    { runMutation, scheduler: { runAfter } } as any,
    { component: { event: { append: "event.append" } } as any },
    eventInput,
  );

  expect(runMutation).not.toHaveBeenCalled();
  expect(runAfter).toHaveBeenCalledOnce();
  expect(runAfter.mock.calls[0]?.[0]).toBe(0);
  expect(runAfter.mock.calls[0]?.[1]).toBe("event.append");
  expect(runAfter.mock.calls[0]?.[2]).toMatchObject({
    event: { kind: "session.signed_in" },
    targets: eventInput.targets,
  });
});

test("a configured event handler preserves synchronous idempotent delivery", async () => {
  const handler = vi.fn();
  const runMutation = vi.fn().mockResolvedValue({
    eventId: "event-1",
    created: true,
    createdTargets: eventInput.targets,
    projections: [],
  });
  const runAfter = vi.fn();

  await queueAuthEvent(
    { runMutation, scheduler: { runAfter } } as any,
    {
      component: { event: { append: "event.append" } } as any,
      events: { session: { signedIn: handler } },
    },
    { ...eventInput, eventId: "event-1" },
  );

  expect(runAfter).not.toHaveBeenCalled();
  expect(runMutation).toHaveBeenCalledOnce();
  expect(handler).toHaveBeenCalledOnce();
});
