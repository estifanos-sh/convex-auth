/**
 * Lightweight permissions helpers.
 *
 * @module
 */

/**
 * Define typed permissions for Convex Auth.
 *
 * Grants are the atomic permissions your app checks at runtime. Roles are
 * named bundles of those grants that can be assigned to group memberships.
 * The returned object preserves literal role IDs and grant strings so
 * `member.get()` / `member.assert()` and `member.create()` calls can be
 * checked at compile time.
 *
 * @param config - Permission config with optional top-level `grants` and
 *   required role definitions.
 * @typeParam TGrants - The declared grant strings.
 * @typeParam TRoles - The object literal shape of your role definitions.
 * @returns A normalized permissions config with `roles.<id>.id` populated.
 *
 * @example
 * ```ts
 * import { definePermissions } from "@estifanos-sh/convex-auth/permissions";
 *
 * const permissions = definePermissions({
 *   grants: ["issues:read", "issues:write", "members:manage"],
 *   roles: {
 *     admin: { label: "Administrator", grants: ["issues:write", "members:manage"] },
 *     member: { label: "Member", grants: ["issues:write"] },
 *     viewer: { grants: ["issues:read"] },
 *   },
 * });
 *
 * // permissions.roles.admin.id === "admin"
 *
 * // Pass to defineAuth:
 * const auth = defineAuth(components.auth, {
 *   providers: [...],
 *   permissions,
 * });
 * ```
 *
 * @example
 * ```ts
 * type RoleId = keyof typeof permissions.roles;
 * // RoleId = "admin" | "member" | "viewer"
 * ```
 *
 * @see {@link ConvexAuthConfig}
 */
export function definePermissions<
  const TRoles extends Record<string, { label?: string; grants: readonly string[] }>,
>(config: {
  roles: TRoles;
}): {
  grants: [];
  roles: NormalizedRoles<TRoles>;
};
export function definePermissions<
  const TGrants extends readonly string[],
  const TRoles extends Record<string, { label?: string; grants: readonly TGrants[number][] }>,
>(config: {
  grants: TGrants;
  roles: TRoles;
}): {
  grants: Array<TGrants[number] & string>;
  roles: NormalizedRoles<TRoles>;
};
export function definePermissions<
  const TGrants extends readonly string[],
  const TRoles extends Record<string, { label?: string; grants: readonly string[] }>,
>(config: { grants?: TGrants; roles: TRoles }) {
  return {
    grants: [...(config.grants ?? [])],
    roles: normalizeRoles(config.roles),
  };
}

type NormalizedRoles<TRoles extends Record<string, { label?: string; grants: readonly string[] }>> =
  {
    [K in keyof TRoles]: {
      id: K & string;
      label?: TRoles[K]["label"];
      grants: Array<TRoles[K]["grants"][number] & string>;
    };
  };

type NormalizedRole = {
  id: string;
  label?: string;
  grants: string[];
};

function normalizeRoles<
  const TRoles extends Record<string, { label?: string; grants: readonly string[] }>,
>(roles: TRoles): NormalizedRoles<TRoles> {
  return Object.fromEntries(
    Object.entries(roles).map(([id, role]) => [id, normalizeRole(id, role)]),
  ) as NormalizedRoles<TRoles>;
}

function normalizeRole(
  id: string,
  role: { label?: string; grants: readonly string[] },
): NormalizedRole {
  const normalized: NormalizedRole = { id, grants: [...role.grants] };
  if (role.label !== undefined) normalized.label = role.label;
  return normalized;
}
