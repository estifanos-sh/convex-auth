/**
 * The one decoder of what WorkOS sends: a Convex validator walks the JSON,
 * checks every field it names and keeps only those. WorkOS adds fields over
 * time, so unknown fields are dropped rather than refused, and it writes an
 * absent value as `null`, so `null` in an optional field is taken as absent.
 *
 * @module
 */
import type { GenericValidator, Infer, Validator } from "convex/values";

/**
 * A payload that does not have the shape its validator names. The message
 * says where, never what: the payloads carry directory data.
 */
export class DecodeError extends Error {
  override readonly name = "DecodeError";

  constructor(
    readonly path: string,
    expected: string,
  ) {
    super(`WorkOS sent ${path || "a payload"} that is not ${expected}`);
  }
}

/** `value` as `validator` describes it, or a {@link DecodeError}. */
export function decode<V extends Validator<unknown, "required", string>>(
  validator: V,
  value: unknown,
): Infer<V> {
  // The walk checked every field the type names, which is what the type says.
  return walk(validator, value, "") as Infer<V>;
}

function walk(
  validator: GenericValidator,
  value: unknown,
  path: string,
): unknown {
  switch (validator.kind) {
    case "object": {
      const fields = record(value, path);
      const decoded: Record<string, unknown> = {};
      for (const [name, field] of Object.entries(validator.fields)) {
        const raw = fields[name];
        if (field.isOptional === "optional" && (raw ?? null) === null) {
          continue;
        }
        decoded[name] = walk(field, raw, `${path}.${name}`);
      }
      return decoded;
    }
    case "union": {
      const errors: DecodeError[] = [];
      for (const member of validator.members) {
        try {
          return walk(member, value, path);
        } catch (error) {
          if (!(error instanceof DecodeError)) throw error;
          errors.push(error);
        }
      }
      // The one member that got furthest is the one the payload meant, as
      // when an event's name matched and its data did not. When no member
      // got further than the rest, the payload named no member.
      const depth = Math.max(...errors.map((error) => error.path.length));
      const furthest = errors.filter((error) => error.path.length === depth);
      if (furthest.length === 1) throw furthest[0];
      throw new DecodeError(path, `one of ${tag(value) ?? "its kinds"}`);
    }
    case "array": {
      if (!Array.isArray(value)) throw new DecodeError(path, "a list");
      return value.map((item, index) =>
        walk(validator.element, item, `${path}[${index}]`),
      );
    }
    case "record": {
      const fields = record(value, path);
      return Object.fromEntries(
        Object.entries(fields).map(([key, item]) => [
          key,
          walk(validator.value, item, `${path}.${key}`),
        ]),
      );
    }
    case "literal":
      if (value !== validator.value) {
        throw new DecodeError(path, JSON.stringify(validator.value));
      }
      return value;
    case "string":
    case "id":
      if (typeof value !== "string") throw new DecodeError(path, "text");
      return value;
    case "float64":
      if (typeof value !== "number") throw new DecodeError(path, "a number");
      return value;
    case "boolean":
      if (typeof value !== "boolean") throw new DecodeError(path, "a boolean");
      return value;
    case "null":
      if (value !== null) throw new DecodeError(path, "null");
      return value;
    case "any":
      return value;
    case "int64":
    case "bytes":
    case "commitTs":
      throw new DecodeError(
        path,
        `a ${validator.kind}, which JSON cannot hold`,
      );
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError(path, "an object");
  }
  return Object.fromEntries(Object.entries(value));
}

/**
 * The `event` or `object` tag of a payload no member matched, which names a
 * kind and carries no directory data, for the message.
 */
function tag(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const fields = Object.fromEntries(Object.entries(value));
  for (const name of ["event", "object"]) {
    const field = fields[name];
    if (typeof field === "string" && /^[a-z_.]{1,64}$/.test(field)) {
      return `its kinds (it says ${name} "${field}")`;
    }
  }
  return undefined;
}
