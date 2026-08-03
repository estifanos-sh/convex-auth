import workpoolTest from "@convex-dev/workpool/test";
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";

import modules from "./component/modules";
import schema from "./component/schema";

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
 * import { register } from "@robelest/convex-auth/test";
 *
 * const t = convexTest(schema);
 * register(t);
 * ```
 */
export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name: string = "auth",
) {
  t.registerComponent(name, schema, modules);
  workpoolTest.register(t, `${name}/webhookWorkpool`);
}

const testHelpers: {
  register: typeof register;
  schema: SchemaDefinition<GenericSchema, boolean>;
  modules: Record<string, () => Promise<unknown>>;
} = {
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
 * import authTest from "@robelest/convex-auth/test";
 * import { convexTest } from "convex-test";
 *
 * const t = convexTest(schema);
 * authTest.register(t);
 * ```
 */
export default testHelpers;
