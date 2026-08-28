/**
 * Configure the password provider for email/password authentication.
 *
 * Six flows, all single-word camelCase:
 *
 * - `signUp` — Create a new account.
 * - `signIn` — Sign in with email + password.
 * - `reset` — Kick off a forgot-password flow (issues an OTP via email).
 * - `recover` — Verify a reset OTP and set a new password, optionally continuing
 *   into the configured `afterReset` operation.
 * - `verify` — Complete post-signup email confirmation.
 * - `change` — Authenticated password change (requires `currentPassword`).
 *
 * ```ts
 * import { password } from "@estifanos-sh/convex-auth/providers/password";
 *
 * password()
 * password({ verify: myEmailProvider, reset: myEmailProvider })
 * ```
 *
 * @module
 */

import { scryptAsync } from "@noble/hashes/scrypt.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { DocumentByName, GenericDataModel, WithoutSystemFields } from "convex/server";
import { GenericId, v } from "convex/values";

import { emitAuthEvent } from "../server/events";
import { getAuthenticatedUserIdOrNull } from "../server/identity/claims";
import { callCredentialsSignIn } from "../server/mutations/calls";
import { maxSignInAttempts } from "../server/limits";
import { sha256 } from "../server/random";
import { mutatePasswordRecovery } from "../server/component/factor/db";
import type { Hashed } from "../shared/brand";
import { ErrorCode } from "../shared/codes";
import { convexError } from "../server/errors";
import type { PasswordParams } from "../shared/params";
import type {
  EmailConfig,
  GenericActionCtxWithAuthConfig,
  GenericDoc,
  ConvexCredentialsConfig,
  WebAuthnRotateOperation,
} from "../server/types";
import { credentials, type CredentialsConfig } from "./credentials";

type PasswordEmailProviderFactory = () => EmailConfig<any>;

type PasswordConfigBase<DataModel extends GenericDataModel, Id extends string = "password"> = {
  /**
   * Uniquely identifies the provider, allowing multiple password providers.
   */
  id?: Id;
  /**
   * Perform checks on provided params and customize the user information
   * stored after sign up, including email normalization.
   *
   * Called for every flow.
   */
  profile?: (
    params: PasswordParams,
    ctx: GenericActionCtxWithAuthConfig<DataModel>,
  ) => WithoutSystemFields<DocumentByName<DataModel, "User">> & {
    email: string;
  };
  /**
   * Performs custom validation on a password during `signUp`, `recover`, and
   * `change`.
   *
   * Default: non-empty, length >= 8.
   *
   * Throw an `Error` to reject the password.
   */
  validatePasswordRequirements?: (password: string) => void;
  /**
   * Hashing and verification functions. Defaults to scrypt.
   */
  crypto?: CredentialsConfig["crypto"];
  /**
   * Email provider for post-signup email confirmation. Issues OTPs that the
   * `verify` flow accepts.
   */
  verify?: EmailConfig<any> | PasswordEmailProviderFactory;
};

/**
 * Configuration for the {@link password} provider.
 *
 * An `afterReset` passkey operation requires a reset email provider, so an
 * invalid recovery flow cannot be configured.
 */
export type PasswordConfig<DataModel extends GenericDataModel, Id extends string = "password"> =
  | (PasswordConfigBase<DataModel, Id> & {
      reset?: undefined;
      afterReset?: never;
    })
  | (PasswordConfigBase<DataModel, Id> & {
      /** Email provider for the `reset` flow. Issues OTPs accepted by `recover`. */
      reset: EmailConfig<any> | PasswordEmailProviderFactory;
      /**
       * Continue reset recovery with a typed provider operation before a session
       * is issued. The password is committed only when that operation succeeds.
       */
      afterReset?: WebAuthnRotateOperation;
    });

const PASSWORD_FLOWS = ["signUp", "signIn", "reset", "recover", "verify", "change"] as const;
type PasswordFlow = (typeof PASSWORD_FLOWS)[number];

type PasswordFlowDispatch = { tag: PasswordFlow } | { tag: "invalid"; flow: unknown };

type PasswordAuthorizeResult<DataModel extends GenericDataModel> = Awaited<
  ReturnType<CredentialsConfig<typeof vPasswordParams, DataModel>["authorize"]>
>;

const vRedirectTo = { redirectTo: v.optional(v.string()) };
const vPasswordParams = v.union(
  v.object({ flow: v.literal("signUp"), email: v.string(), password: v.string(), ...vRedirectTo }),
  v.object({ flow: v.literal("signIn"), email: v.string(), password: v.string(), ...vRedirectTo }),
  v.object({ flow: v.literal("reset"), email: v.string(), ...vRedirectTo }),
  v.object({
    flow: v.literal("recover"),
    email: v.string(),
    code: v.string(),
    newPassword: v.string(),
    ...vRedirectTo,
  }),
  v.object({
    flow: v.literal("verify"),
    email: v.string(),
    code: v.optional(v.string()),
    ...vRedirectTo,
  }),
  v.object({
    flow: v.literal("change"),
    email: v.string(),
    currentPassword: v.string(),
    newPassword: v.string(),
    ...vRedirectTo,
  }),
);

function decodePasswordFlow(flow: unknown): PasswordFlowDispatch {
  if (typeof flow === "string" && (PASSWORD_FLOWS as readonly string[]).includes(flow)) {
    return { tag: flow as PasswordFlow };
  }
  return { tag: "invalid", flow };
}

/**
 * Email and password authentication provider.
 *
 * Passwords are hashed with scrypt by default. Customize via `crypto`.
 *
 * Email verification is opt-in via the `verify` option. Password reset is
 * opt-in via the `reset` option (typically the same email provider).
 *
 * @example
 * ```ts
 * password()
 * password({ verify: myEmailProvider, reset: myEmailProvider })
 * ```
 *
 * @typeParam DataModel - The Convex data model used by the auth context.
 * @param config - Password flow hooks and optional verification providers.
 * @returns A configured password provider for `defineAuth`.
 */
export function password<
  DataModel extends GenericDataModel = GenericDataModel,
  const Id extends string = "password",
>(
  config: PasswordConfig<DataModel, Id> = {} as PasswordConfig<DataModel, Id>,
): ConvexCredentialsConfig<DataModel, typeof vPasswordParams, Id> {
  const provider = (config.id ?? "password") as Id;
  const resetProvider = typeof config.reset === "function" ? config.reset() : config.reset;
  const verifyProvider = typeof config.verify === "function" ? config.verify() : config.verify;
  const afterReset = config.afterReset;
  const extraProviders = [resetProvider, verifyProvider, afterReset?.provider]
    .filter(
      (extraProvider): extraProvider is NonNullable<typeof extraProvider> =>
        extraProvider !== undefined,
    )
    .filter((extraProvider, index, providers) => providers.indexOf(extraProvider) === index);
  const crypto = config.crypto ?? {
    async hashSecret(password: string) {
      return await hashPassword(password);
    },
    async verifySecret(password: string, hash: string) {
      return await verifyPassword(password, hash);
    },
  };

  return credentials<typeof vPasswordParams, DataModel, Id>({
    id: provider,
    params: vPasswordParams,
    authorize: async (params, ctx) => {
      const flowDispatch = decodePasswordFlow(params.flow);

      const validatePasswordRequirements = (password: string) => {
        if (config.validatePasswordRequirements !== undefined) {
          config.validatePasswordRequirements(password);
          return;
        }
        validateDefaultPasswordRequirements(password);
      };

      const profile = config.profile?.(params, ctx) ?? defaultProfile(params);
      const { email } = profile;

      const requireStringParam = (value: unknown, name: string, flow: PasswordFlow) => {
        if (typeof value !== "string" || value.length === 0) {
          throw new Error(`Missing \`${name}\` param for \`${flow}\` flow`);
        }
        return value;
      };

      const finalizeCredentialsResult = async (
        account: GenericDoc<DataModel, "Account">,
        user: GenericDoc<DataModel, "User">,
      ) => {
        if (verifyProvider && !account.emailVerified) {
          return await ctx.auth.provider.signIn(ctx, {
            provider: verifyProvider,
            accountId: account._id,
            params,
          });
        }
        return { userId: user._id, hasTotp: false };
      };

      const flowHandlers = {
        signUp: async () => {
          const secret = requireStringParam(
            "password" in params ? params.password : undefined,
            "password",
            "signUp",
          );
          validatePasswordRequirements(secret);
          const created = await ctx.auth.account.create(ctx, {
            provider,
            account: { id: email, secret },
            profile,
            shouldLinkViaEmail: config.verify !== undefined,
            shouldLinkViaPhone: false,
          });
          return await finalizeCredentialsResult(created.account, created.user);
        },

        signIn: async () => {
          const secret = requireStringParam(
            "password" in params ? params.password : undefined,
            "password",
            "signIn",
          );
          const result = await callCredentialsSignIn(ctx, {
            provider,
            account: { id: email, secret },
            generateTokens: true,
            requireVerifiedEmail: verifyProvider !== undefined,
            enforceTotp: true,
            // `password` itself may be registered as another credentials
            // provider's extra provider, so the store lookup has to see them.
            allowExtraProviders: true,
          });
          if (result.kind === "invalidAccount" || result.kind === "invalidSecret") {
            throw convexError(ErrorCode.INVALID_CREDENTIALS, "Invalid credentials");
          }
          if (result.kind === "tooManyAttempts") {
            throw convexError(
              ErrorCode.RATE_LIMITED,
              "Too many failed sign-in attempts. Please try again later.",
            );
          }
          if (result.kind === "emailVerificationRequired") {
            return await ctx.auth.provider.signIn(ctx, {
              provider: verifyProvider!,
              accountId: result.account._id as GenericDoc<DataModel, "Account">["_id"],
              params,
            });
          }
          const hasTotp = result.kind === "signedIn" ? result.user.hasTotp : true;
          if (result.kind === "signedIn") {
            return {
              userId: result.user._id as GenericDoc<DataModel, "User">["_id"],
              hasTotp,
              issuance: result.issuance,
            };
          }
          return {
            userId: result.user._id as GenericDoc<DataModel, "User">["_id"],
            hasTotp,
          };
        },

        reset: async () => {
          if (!resetProvider) {
            throw new Error(`Password reset is not enabled for ${provider}`);
          }
          const result = await ctx.auth.account.get(ctx, {
            provider,
            account: { id: email },
          });
          if (result === null) {
            return { kind: "started" as const };
          }
          return await ctx.auth.provider.signIn(ctx, {
            provider: resetProvider,
            accountId: result.account._id,
            params,
          });
        },

        recover: async () => {
          const code = requireStringParam(
            "code" in params ? params.code : undefined,
            "code",
            "recover",
          );
          const newPassword = requireStringParam(
            "newPassword" in params ? params.newPassword : undefined,
            "newPassword",
            "recover",
          );
          if (!resetProvider) {
            throw new Error(`Password reset is not enabled for ${provider}`);
          }
          validatePasswordRequirements(newPassword);
          if (afterReset !== undefined) {
            const account = await ctx.auth.account.get(ctx, {
              provider,
              account: { id: email },
            });
            if (account === null) {
              throw convexError(ErrorCode.INVALID_CREDENTIALS, "Invalid code");
            }
            if (resetProvider.authorize !== undefined) {
              await resetProvider.authorize(params, account.account);
            }
            const recovery = await mutatePasswordRecovery(ctx, {
              accountId: account.account._id,
              code: (await sha256(code)) as Hashed<"VerificationCode">,
              identifier: email,
              maxAttemptsPerHour: maxSignInAttempts(ctx.auth.config),
              now: Date.now(),
              passwordProvider: provider,
              provider: afterReset.provider.id,
              resetProvider: resetProvider.id,
              secret: await crypto.hashSecret(newPassword),
              verifier: undefined,
              expirationTime:
                Date.now() + (afterReset.provider.options.challengeExpirationMs ?? 300_000),
              operation: afterReset.operation,
            });
            if (recovery.status === "limited") {
              throw convexError(
                ErrorCode.RATE_LIMITED,
                "Too many failed recovery attempts. Please try again later.",
              );
            }
            if (recovery.status !== "accepted") {
              throw convexError(ErrorCode.INVALID_CREDENTIALS, "Invalid code");
            }
            return await ctx.auth.provider.continueRecovery(ctx, {
              userId: recovery.userId as GenericDoc<DataModel, "User">["_id"],
              continuationId: recovery.continuationId as GenericId<"AuthContinuation">,
              operation: afterReset,
            });
          }
          const result = await ctx.auth.provider.signIn(ctx, {
            provider: resetProvider,
            params,
          });
          if (result === null) {
            throw convexError(ErrorCode.INVALID_CREDENTIALS, "Invalid code");
          }
          if ("kind" in result) {
            throw convexError(ErrorCode.INVALID_CREDENTIALS, "Invalid code");
          }
          const { userId, sessionId } = result;
          await ctx.auth.account.update(ctx, {
            provider,
            account: { id: email, secret: newPassword },
          });
          await ctx.auth.session.revoke(ctx, {
            userId,
            except: [sessionId],
          });
          await emitAuthEvent(ctx, ctx.auth.config, {
            kind: "password.changed",
            actor: { type: "user", id: userId },
            subject: { type: "user", id: userId },
            targets: [{ kind: "user", id: userId }],
            outcome: "success",
            data: { flow: "reset" },
          });
          return { userId, sessionId };
        },

        verify: async () => {
          if (!verifyProvider) {
            throw new Error(`Email verification is not enabled for ${provider}`);
          }
          const result = await ctx.auth.account.get(ctx, {
            provider,
            account: { id: email },
          });
          if (result === null) {
            return { kind: "started" as const };
          }
          return await ctx.auth.provider.signIn(ctx, {
            provider: verifyProvider,
            accountId: result.account._id,
            params,
          });
        },

        change: async () => {
          const authedUserId = await getAuthenticatedUserIdOrNull(ctx);
          if (authedUserId === null) {
            throw convexError(ErrorCode.NOT_SIGNED_IN, "Sign in first to change your password.");
          }
          const currentPassword = requireStringParam(
            "currentPassword" in params ? params.currentPassword : undefined,
            "currentPassword",
            "change",
          );
          const newPassword = requireStringParam(
            "newPassword" in params ? params.newPassword : undefined,
            "newPassword",
            "change",
          );
          validatePasswordRequirements(newPassword);

          const result = await callCredentialsSignIn(ctx, {
            provider,
            account: { id: email, secret: currentPassword },
            generateTokens: true,
            requireVerifiedEmail: false,
            enforceTotp: false,
            allowExtraProviders: true,
          });
          if (result.kind === "invalidAccount" || result.kind === "invalidSecret") {
            throw convexError(ErrorCode.INVALID_CREDENTIALS, "Invalid current password");
          }
          if (result.kind === "tooManyAttempts") {
            throw convexError(
              ErrorCode.RATE_LIMITED,
              "Too many failed attempts. Please try again later.",
            );
          }
          if (result.kind !== "signedIn") {
            throw new Error(`Unexpected sign-in result: ${result.kind}`);
          }
          const verifiedUserId = result.user._id as GenericDoc<DataModel, "User">["_id"];
          if (verifiedUserId !== authedUserId) {
            throw new Error("Email does not match authenticated user");
          }
          await ctx.auth.account.update(ctx, {
            provider,
            account: { id: email, secret: newPassword },
          });
          await ctx.auth.session.revoke(ctx, {
            userId: verifiedUserId,
            except: [result.issuance.sessionId],
          });
          await emitAuthEvent(ctx, ctx.auth.config, {
            kind: "password.changed",
            actor: { type: "user", id: verifiedUserId },
            subject: { type: "user", id: verifiedUserId },
            targets: [{ kind: "user", id: verifiedUserId }],
            outcome: "success",
            data: { flow: "change" },
          });
          return {
            userId: verifiedUserId,
            hasTotp: false,
            issuance: result.issuance,
          };
        },
      } satisfies Record<PasswordFlow, () => Promise<PasswordAuthorizeResult<DataModel>>>;

      if (flowDispatch.tag === "invalid") {
        throw new Error(
          "Missing or invalid `flow` param. Expected one of: " + PASSWORD_FLOWS.join(", ") + ".",
        );
      }
      return await flowHandlers[flowDispatch.tag]();
    },
    ...config,
    crypto,
    extraProviders,
  });
}

function validateDefaultPasswordRequirements(password: string) {
  if (!password || password.length < 8) {
    throw new Error("Invalid password");
  }
}

function defaultProfile(params: PasswordParams) {
  const email = params.email;
  if (typeof email !== "string" || email.trim().length === 0) {
    throw new Error("Missing `email` param");
  }
  return {
    email,
  };
}

const PASSWORD_HASH_PARAMS = {
  N: 16384,
  r: 16,
  p: 1,
  dkLen: 64,
} as const;

const PASSWORD_HASH_PREFIX = `scrypt:N=${PASSWORD_HASH_PARAMS.N},r=${PASSWORD_HASH_PARAMS.r},p=${PASSWORD_HASH_PARAMS.p},dkLen=${PASSWORD_HASH_PARAMS.dkLen}`;

async function hashPassword(password: string): Promise<Hashed<"Password">> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const hash = await scryptAsync(password, salt, PASSWORD_HASH_PARAMS);
  return `${PASSWORD_HASH_PREFIX}$${bytesToHex(salt)}$${bytesToHex(hash)}` as Hashed<"Password">;
}

async function verifyPassword(password: string, storedHash: string) {
  const [prefix, saltHex, hashHex] = storedHash.split("$");
  if (prefix !== PASSWORD_HASH_PREFIX || saltHex === undefined || hashHex === undefined) {
    return false;
  }

  let salt: Uint8Array;
  let expectedHash: Uint8Array;
  try {
    salt = hexToBytes(saltHex);
    expectedHash = hexToBytes(hashHex);
  } catch {
    return false;
  }
  if (salt.length !== 32 || expectedHash.length !== PASSWORD_HASH_PARAMS.dkLen) {
    return false;
  }

  const actualHash = await scryptAsync(password, salt, PASSWORD_HASH_PARAMS);
  return constantTimeEqual(actualHash, expectedHash);
}

function hexToBytes(hex: string) {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid password hash");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const start = i * 2;
    const value = Number.parseInt(hex.slice(start, start + 2), 16);
    if (Number.isNaN(value)) {
      throw new Error("Invalid password hash");
    }
    bytes[i] = value;
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
}
