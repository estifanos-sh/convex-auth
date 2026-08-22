import { defineAuth } from "@estifanos-sh/convex-auth/server";
import { type GenericId, type Infer, v } from "convex/values";

import { components } from "../../../convex/_generated/api";

type Assert<T extends true> = T;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;

declare const readCtx: Parameters<ReturnType<typeof defineAuth>["user"]["get"]>[0];
declare const inviteId: GenericId<"GroupInvite">;
declare const sessionId: GenericId<"Session">;
declare const userId: GenericId<"User">;
declare const groupId: GenericId<"Group">;

const extendedAuth = defineAuth(components.auth, {
  providers: [],
  extend: {
    GroupInvite: v.object({ campaign: v.string() }),
  },
});
declare const inviteCreateCtx: Parameters<typeof extendedAuth.invite.create>[0];

void extendedAuth.invite.create(inviteCreateCtx, {
  data: { email: "invite@example.com", extend: { campaign: "summer" } },
});
void extendedAuth.invite.create(inviteCreateCtx, {
  data: {
    email: "invite@example.com",
    // @ts-expect-error Invite extension writes use the configured validator shape.
    extend: { campaign: 42 },
  },
});

const extendedInvite = extendedAuth.invite.get(readCtx, { id: inviteId });
type ExtendedInvite = NonNullable<Awaited<typeof extendedInvite>>;
type _GroupInviteExtensionFlowsThroughFacade = Assert<
  Equal<ExtendedInvite["extend"], { campaign: string } | undefined>
>;
type _GroupInviteExtensionFlowsThroughValidator = Assert<
  Equal<Infer<typeof extendedAuth.v.invite>["extend"], { campaign: string } | undefined>
>;

const defaultAuth = defineAuth(components.auth, { providers: [] });
type DefaultInvite = NonNullable<Awaited<ReturnType<typeof defaultAuth.invite.get>>>;
type _DefaultInviteExtensionIsUnknown = Assert<Equal<DefaultInvite["extend"], unknown>>;

void extendedAuth.session.get(readCtx, { id: sessionId });
void extendedAuth.session.list(readCtx, { userId });
// @ts-expect-error Session lookups only accept Session IDs.
void extendedAuth.session.get(readCtx, { id: groupId });
// @ts-expect-error Invite lookups only accept GroupInvite IDs.
void extendedAuth.invite.get(readCtx, { id: userId });
