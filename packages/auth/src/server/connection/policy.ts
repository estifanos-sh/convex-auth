import type { GroupConnectionPolicy, GroupConnectionPolicyPatch } from "../types";
import { asRecord } from "./shared";

const DEFAULT_GROUP_CONNECTION_POLICY: GroupConnectionPolicy = {
  version: 1,
  identity: {
    accountLinking: {
      oidc: "sameConnection",
      saml: "sameConnection",
    },
  },
  provisioning: {
    user: {
      createOnSignIn: true,
      updateProfileOnLogin: "missing",
      updateProfileFromScim: "always",
      authority: "app",
    },
    jit: {
      mode: "createUserAndMembership",
      defaultRoleIds: [],
    },
    deprovision: {
      mode: "soft",
    },
    groups: {
      mode: "ignore",
      source: "protocol",
    },
    roles: {
      mode: "ignore",
      source: "protocol",
    },
  },
};

/** Accept a value only if it's one of the allowed options, otherwise return the fallback. */
function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Parse an object whose values are string arrays (e.g. group→roleIds mapping). */
function parseStringArrayMapping(raw: unknown): Record<string, string[]> | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([key, value]) => typeof key === "string" && Array.isArray(value))
      .map(([key, value]) => [
        key,
        Array.from(
          new Set(
            (value as unknown[]).filter(
              (item): item is string => typeof item === "string" && item.length > 0,
            ),
          ),
        ),
      ]),
  );
}

export function normalizeGroupConnectionPolicy(policy: unknown): GroupConnectionPolicy {
  const d = DEFAULT_GROUP_CONNECTION_POLICY;
  const input = asRecord(policy) ?? {};
  const identity = asRecord(input.identity) ?? {};
  const accountLinking = asRecord(identity.accountLinking) ?? {};
  const provisioning = asRecord(input.provisioning) ?? {};
  const user = asRecord(provisioning.user) ?? {};
  const jit = asRecord(provisioning.jit) ?? {};
  const deprovision = asRecord(provisioning.deprovision) ?? {};
  const groups = asRecord(provisioning.groups) ?? {};
  const roles = asRecord(provisioning.roles) ?? {};
  const extend = asRecord(input.extend) ?? undefined;

  const groupsMapping = parseStringArrayMapping(groups.mapping);
  const rolesMapping = parseStringArrayMapping(roles.mapping);

  const normalized: GroupConnectionPolicy = {
    version: 1,
    identity: {
      accountLinking: {
        oidc: oneOf(
          accountLinking.oidc,
          ["none", "verifiedEmail", "sameConnection"],
          d.identity.accountLinking.oidc,
        ),
        saml: oneOf(
          accountLinking.saml,
          ["none", "verifiedEmail", "sameConnection"],
          d.identity.accountLinking.saml,
        ),
      },
    },
    provisioning: {
      user: {
        createOnSignIn:
          typeof user.createOnSignIn === "boolean"
            ? user.createOnSignIn
            : d.provisioning.user.createOnSignIn,
        updateProfileOnLogin: oneOf(
          user.updateProfileOnLogin,
          ["never", "missing", "always"],
          d.provisioning.user.updateProfileOnLogin,
        ),
        updateProfileFromScim: oneOf(
          user.updateProfileFromScim,
          ["never", "missing", "always"],
          d.provisioning.user.updateProfileFromScim,
        ),
        authority: oneOf(user.authority, ["app", "scim"], d.provisioning.user.authority),
      },
      jit: {
        mode: oneOf(
          jit.mode,
          ["off", "createUser", "createUserAndMembership"],
          d.provisioning.jit.mode,
        ),
        defaultRoleIds: Array.isArray(jit.defaultRoleIds)
          ? Array.from(
              new Set(
                jit.defaultRoleIds.filter(
                  (value): value is string => typeof value === "string" && value.length > 0,
                ),
              ),
            )
          : typeof jit.defaultRole === "string" && jit.defaultRole.length > 0
            ? [jit.defaultRole]
            : d.provisioning.jit.defaultRoleIds,
      },
      deprovision: {
        mode: oneOf(deprovision.mode, ["soft", "hard"], d.provisioning.deprovision.mode),
      },
      groups: {
        mode: oneOf(groups.mode, ["ignore", "sync"], d.provisioning.groups.mode),
        source: "protocol",
      },
      roles: {
        mode: oneOf(roles.mode, ["ignore", "map"], d.provisioning.roles.mode),
        source: "protocol",
      },
    },
  };
  if (groupsMapping) normalized.provisioning.groups.mapping = groupsMapping;
  if (rolesMapping) normalized.provisioning.roles.mapping = rolesMapping;
  if (extend) normalized.extend = extend;
  return normalized;
}

export function patchGroupConnectionPolicy(
  current: unknown,
  patch: GroupConnectionPolicyPatch,
): GroupConnectionPolicy {
  const base = normalizeGroupConnectionPolicy(current);
  return normalizeGroupConnectionPolicy({
    ...base,
    ...patch,
    identity: {
      ...base.identity,
      ...patch.identity,
      accountLinking: {
        ...base.identity.accountLinking,
        ...patch.identity?.accountLinking,
      },
    },
    provisioning: {
      ...base.provisioning,
      ...patch.provisioning,
      user: {
        ...base.provisioning.user,
        ...patch.provisioning?.user,
      },
      jit: {
        ...base.provisioning.jit,
        ...patch.provisioning?.jit,
      },
      deprovision: {
        ...base.provisioning.deprovision,
        ...patch.provisioning?.deprovision,
      },
      groups: {
        ...base.provisioning.groups,
        ...patch.provisioning?.groups,
      },
      roles: {
        ...base.provisioning.roles,
        ...patch.provisioning?.roles,
      },
    },
    extend: patch.extend === undefined ? base.extend : { ...base.extend, ...patch.extend },
  });
}

export function resolveProvisionedRoleIds(opts: {
  policy: GroupConnectionPolicy;
  groups?: string[];
  roles?: string[];
}) {
  const roleIds = new Set<string>(opts.policy.provisioning.jit.defaultRoleIds);

  if (opts.policy.provisioning.groups.mode === "sync") {
    const mapping = opts.policy.provisioning.groups.mapping ?? {};
    for (const group of opts.groups ?? []) {
      for (const roleId of mapping[group] ?? []) {
        roleIds.add(roleId);
      }
    }
  }

  if (opts.policy.provisioning.roles.mode === "map") {
    const mapping = opts.policy.provisioning.roles.mapping ?? {};
    for (const role of opts.roles ?? []) {
      for (const roleId of mapping[role] ?? []) {
        roleIds.add(roleId);
      }
    }
  }

  return Array.from(roleIds);
}
