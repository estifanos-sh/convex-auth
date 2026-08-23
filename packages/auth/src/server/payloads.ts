import { type Infer, v } from "convex/values";

// The JSON-payload validator is owned by the component model; re-exported here
// so server call sites keep importing it from the module they already use.
export { vPayloadRecord } from "../component/model";

const vAccountIdentity = v.object({
  type: v.optional(v.string()),
  provider: v.optional(v.string()),
  providerAccountId: v.optional(v.string()),
  protocol: v.optional(v.string()),
  connectionId: v.optional(v.string()),
  subject: v.optional(v.string()),
  issuer: v.optional(v.string()),
  discoveryUrl: v.optional(v.string()),
  entityId: v.optional(v.string()),
});

export const vAccountExtend = v.object({
  identity: v.optional(vAccountIdentity),
  saml: v.optional(
    v.object({
      attributes: v.optional(v.record(v.string(), v.union(v.string(), v.array(v.string())))),
      sessionIndex: v.optional(v.string()),
    }),
  ),
});

type PayloadPrimitive = string | number | boolean | null;

type PayloadValue =
  | PayloadPrimitive
  | PayloadPrimitive[]
  | Record<string, PayloadPrimitive | PayloadPrimitive[]>;

type PayloadRecord = Record<string, PayloadValue>;

/** Verified profile fields a provider may use to select an existing user. */
export type AuthProfileMatchField = "email" | "phone";

export type SignInParams = PayloadRecord;

export type AuthProfile = PayloadRecord & {
  email?: string;
  phone?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
};

/** Provider-supplied account metadata, derived from {@link vAccountExtend}. */
export type AuthAccountExtend = Infer<typeof vAccountExtend>;
