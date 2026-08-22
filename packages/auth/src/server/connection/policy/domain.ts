import { ErrorCode } from "../../../shared/codes";
import type { ComponentCtx, ComponentReadCtx } from "../../component/context";
import { getGroup } from "../../contract";
import { convexError } from "../../errors";
import type { EmitGroupAuthEventInput } from "../group/service";
import type {
  ConvexAuthMaterializedConfig,
  GroupConnectionPolicy,
  GroupConnectionPolicyPatch,
} from "../../types";
import { patchGroupConnectionPolicy } from "../policy";

type PolicyDeps = {
  config: ConvexAuthMaterializedConfig;
  loadGroupPolicyOrThrow: (
    ctx: ComponentReadCtx,
    groupId: string,
  ) => Promise<GroupConnectionPolicy>;
  validateGroupConnectionPolicy: (
    policy: GroupConnectionPolicy,
  ) => Array<{ name: string; ok: boolean; message?: string }>;
  hasActiveScimConnection: (ctx: ComponentReadCtx, groupId: string) => Promise<boolean>;
  emitGroupAuthEvent: (ctx: ComponentCtx, data: EmitGroupAuthEventInput) => Promise<string>;
};

export function createGroupPolicyDomain(deps: PolicyDeps) {
  const {
    config,
    loadGroupPolicyOrThrow,
    validateGroupConnectionPolicy,
    hasActiveScimConnection,
    emitGroupAuthEvent,
  } = deps;

  return {
    get: async (ctx: ComponentReadCtx, args: { groupId: string }) => {
      return await loadGroupPolicyOrThrow(ctx, args.groupId);
    },
    update: async (
      ctx: ComponentCtx,
      args: { groupId: string; patch: GroupConnectionPolicyPatch },
    ) => {
      const { groupId } = args;
      const group = await getGroup(ctx, config.component.group, groupId);
      if (!group) {
        throw convexError(ErrorCode.INVALID_PARAMETERS, "Group not found.");
      }
      const policy = patchGroupConnectionPolicy(group.policy, args.patch);
      const invalidChecks = validateGroupConnectionPolicy(policy).filter((check) => !check.ok);
      if (invalidChecks.length > 0) {
        throw convexError(
          ErrorCode.INVALID_PARAMETERS,
          invalidChecks.map((check) => check.message ?? check.name).join(" "),
        );
      }
      if (
        policy.provisioning.user.authority === "scim" &&
        !(await hasActiveScimConnection(ctx, groupId))
      ) {
        throw convexError(
          ErrorCode.INVALID_PARAMETERS,
          "SCIM-managed provisioning requires an active SCIM configuration.",
        );
      }
      await ctx.runMutation(config.component.group.update, {
        id: groupId,
        patch: { policy },
      });
      await emitGroupAuthEvent(ctx, {
        groupId,
        kind: "connection.policy.updated",
        actor: { type: "system" },
        subject: { type: "group", id: groupId },
        data: { version: policy.version },
      });
      return policy;
    },
    validate: async (ctx: ComponentReadCtx, args: { groupId: string }) => {
      const { groupId } = args;
      const group = await getGroup(ctx, config.component.group, groupId);
      if (!group) {
        return {
          ok: false,
          groupId,
          checks: [
            {
              name: "group_exists",
              ok: false,
              message: "Group not found.",
            },
          ],
        };
      }
      const policy = await loadGroupPolicyOrThrow(ctx, groupId);
      const checks = validateGroupConnectionPolicy(policy);
      return {
        ok: checks.every((check: { ok: boolean }) => check.ok),
        groupId,
        policy,
        checks,
      };
    },
  };
}
