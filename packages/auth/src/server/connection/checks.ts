/**
 * The `checks[]` entries returned by the connection `validate` / `status`
 * verbs, and the constructors that build them.
 *
 * @module
 */

/** One entry of a connection `checks[]` array. */
export type ConnectionCheck = {
  name: string;
  ok: boolean;
  message?: string;
};

/**
 * A check whose `message` explains a failure and is dropped on success.
 *
 * `{ name, ok, message: undefined }` and `{ name, ok }` are the same value on
 * the wire: `convexToJson` skips `undefined` object fields at every depth, and
 * `vConnectionCheck` declares `message` optional. Pinned by
 * `tests/connection-check.node.test.ts` — do not "fix" this by branching on
 * `ok` at the call site.
 *
 * @internal
 */
export const check = (name: string, ok: boolean, whenFailed?: string): ConnectionCheck => ({
  name,
  ok,
  message: ok ? undefined : whenFailed,
});

/**
 * A check that reports `message` whichever way it went — an advisory note, or a
 * message the caller already computed for both outcomes.
 *
 * @internal
 */
export const checkWithMessage = (
  name: string,
  ok: boolean,
  message: string | undefined,
): ConnectionCheck => ({ name, ok, message });

/**
 * The whole result a `validate` verb returns when the connection id resolves to
 * nothing — one failed check instead of a thrown error, so callers can render
 * it beside the checks a real connection would have produced.
 *
 * @internal
 */
export const connectionNotFound = (connectionId: string) => ({
  ok: false,
  connectionId,
  checks: [check("group_connection_exists", false, "Connection not found.")],
});
