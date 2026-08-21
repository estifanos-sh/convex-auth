import type { ComponentReadCtx } from "../component/context";
import { configDefaults } from "../config";
import type { Doc } from "../types";

type ActiveSnapshot = {
  groupId: string;
  group: Doc<"Group"> | null;
  membership: Doc<"GroupMember">;
  roleIds: string[];
  grants: string[];
};

type AuthContextSnapshot = {
  user: Doc<"User"> | null;
  session: Doc<"Session"> | null;
  active: ActiveSnapshot | null;
};

export type ContextDeps = {
  config: ReturnType<typeof configDefaults>;
  resolveGrantedPermissions: (roleIds?: string[]) => string[];
};

/**
 * Build the internal auth-context reader.
 *
 * One component query returns the current user, optional session, active
 * membership, and group. It intentionally does not memoize authorization
 * state: a fresh component snapshot is the revocation boundary.
 *
 * @internal
 */
export function createContextDomain(deps: ContextDeps) {
  const { config, resolveGrantedPermissions } = deps;

  return {
    get: async (
      ctx: ComponentReadCtx,
      args: { userId: string; sessionId?: string },
    ): Promise<AuthContextSnapshot> => {
      const snapshot = (await ctx.runQuery(config.component.context.get, args)) as {
        user: Doc<"User"> | null;
        session: Doc<"Session"> | null;
        active: {
          groupId: string;
          group: Doc<"Group"> | null;
          membership: Doc<"GroupMember">;
        } | null;
      };

      if (snapshot.active === null) {
        return {
          user: snapshot.user,
          session: snapshot.session,
          active: null,
        };
      }
      const roleIds = snapshot.active.membership.roleIds ?? [];
      return {
        ...snapshot,
        active: {
          ...snapshot.active,
          roleIds,
          grants: resolveGrantedPermissions(roleIds),
        },
      };
    },
  };
}
