import workpoolTest from "@convex-dev/workpool/test";
import type { TestConvex } from "convex-test";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  GenericSchema,
  SchemaDefinition,
} from "convex/server";
import type { GenericId } from "convex/values";

import modules from "./component/modules";
import schema from "./component/schema";
import type { AuthComponentApi } from "./server/component/api";

type AuthTestHarness = TestConvex<SchemaDefinition<GenericSchema, boolean>>;

/**
 * Register the Convex Auth component (and its subcomponents) in a
 * `convex-test` environment.
 *
 * Mounts the auth component under `name`, then nests
 * `@convex-dev/workpool` at `<name>/webhookWorkpool`, matching the
 * structure declared by `component/convex.config.ts`.
 *
 * @param t - The `convex-test` test harness.
 * @param name - Component mount name. Defaults to `"auth"`.
 *
 * @example
 * ```ts
 * import { convexTest } from "convex-test";
 * import { register } from "@estifanos-sh/convex-auth/test";
 *
 * const t = convexTest(schema);
 * register(t);
 * ```
 */
export function register(t: AuthTestHarness, name: string = "auth") {
  t.registerComponent(name, schema, modules);
  workpoolTest.register(t, `${name}/webhookWorkpool`);
}

/**
 * Create typed auth fixtures backed by real component documents.
 *
 * Tests should use these helpers instead of inventing string IDs or calling
 * auth-component internals directly. Every returned ID carries its component
 * table brand, and `session.create` also returns the identity object accepted
 * by `t.withIdentity(...)`.
 *
 * @param t - A `convex-test` harness with the auth component registered.
 * @param component - The generated `components.auth` reference.
 * @returns Typed fixture builders for users, groups, memberships, and sessions.
 *
 * @example
 * ```ts
 * const t = convexTest(schema);
 * register(t);
 * const fixture = createAuthTest(t, components.auth);
 * const userId = await fixture.user.create({ data: { email: "alice@example.com" } });
 * const { identity } = await fixture.session.create({ userId });
 * const asAlice = t.withIdentity(identity);
 * ```
 */
export function createAuthTest(t: AuthTestHarness, component: AuthComponentApi) {
  const runMutation = async <
    Reference extends FunctionReference<"mutation", "public" | "internal">,
  >(
    reference: Reference,
    args: FunctionArgs<Reference>,
  ): Promise<FunctionReturnType<Reference>> =>
    await t.run(async (ctx) => await ctx.runMutation(reference, args));

  return {
    user: {
      create: async (args: FunctionArgs<AuthComponentApi["user"]["create"]>) =>
        (await runMutation(component.user.create, args)) as GenericId<"User">,
    },
    group: {
      create: async (args: FunctionArgs<AuthComponentApi["group"]["create"]>) =>
        (await runMutation(component.group.create, args)) as GenericId<"Group">,
    },
    member: {
      create: async (args: FunctionArgs<AuthComponentApi["group"]["member"]["create"]>) =>
        (await runMutation(component.group.member.create, args)) as GenericId<"GroupMember">,
    },
    session: {
      create: async (
        args: Omit<
          FunctionArgs<AuthComponentApi["session"]["create"]>,
          "userId" | "sessionExpirationTime"
        > & {
          userId: GenericId<"User">;
          sessionExpirationTime?: number;
        },
      ) => {
        const result = await runMutation(component.session.create, {
          ...args,
          sessionExpirationTime: args.sessionExpirationTime ?? Date.now() + 60 * 60 * 1000,
        });
        const sessionId = result.sessionId as GenericId<"Session">;
        const userId = result.userId as GenericId<"User">;
        return {
          epoch: result.epoch,
          sessionId,
          userId,
          identity: { subject: userId, sid: sessionId, session_epoch: result.epoch },
        };
      },
    },
  };
}

const testHelpers = {
  create: createAuthTest,
  register,
  schema,
  modules,
};

/**
 * Test helpers bundled for `convex-test` setups.
 *
 * Exposes the auth component `schema`, lazily discovered `modules`, and the
 * `register()` helper as a convenience default export.
 *
 * @example
 * ```ts
 * import authTest from "@estifanos-sh/convex-auth/test";
 * import { convexTest } from "convex-test";
 *
 * const t = convexTest(schema);
 * authTest.register(t);
 * ```
 */
export default testHelpers;
