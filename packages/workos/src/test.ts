/// <reference types="vite/client" />
// This helper ships as TypeScript, not as part of the compiled build: the
// `import.meta.glob` below is a Vite macro that only works if the consumer's
// bundler transforms this file, as `@convex-dev/auth/test` does. The
// consumer must set `allowImportingTsExtensions`.
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import schema from "./component/schema.ts";
const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register the WorkOS component with a `convex-test` instance.
 *
 * @param t - The test convex instance, e.g. from calling `convexTest`.
 * @param name - The mount name of this component instance, as registered in
 *   convex.config.ts. Defaults to `"authWorkos"`.
 */
export function registerWorkos(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name = "authWorkos",
) {
  t.registerComponent(name, schema, modules);
}
export default { registerWorkos, schema, modules };
