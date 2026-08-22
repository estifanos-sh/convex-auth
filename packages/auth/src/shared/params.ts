import type { Value } from "convex/values";

/** Values accepted by provider sign-in parameter objects. */
export type ProviderParams = Record<string, Value | undefined>;

/** Password-provider operations accepted by the stock client. */
export type PasswordParams =
  | { flow: "signUp"; email: string; password: string; redirectTo?: string }
  | { flow: "signIn"; email: string; password: string; redirectTo?: string }
  | { flow: "reset"; email: string; redirectTo?: string }
  | { flow: "recover"; email: string; code: string; newPassword: string; redirectTo?: string }
  | { flow: "verify"; email: string; code?: string; redirectTo?: string }
  | {
      flow: "change";
      email: string;
      currentPassword: string;
      newPassword: string;
      redirectTo?: string;
    };

/** Email-provider initiation parameters. */
export type EmailParams = { email: string; redirectTo?: string };

/** Phone-provider initiation parameters. */
export type PhoneParams = { phone: string; redirectTo?: string };

/** Completion parameters for provider-owned verification codes. */
export type CodeParams = { code: string; redirectTo?: string };

/** Group-connection discovery and selection parameters. */
export type ConnectionParams =
  | { connectionId: string; redirectTo?: string; loginHint?: string }
  | { email: string; redirectTo?: string; loginHint?: string }
  | { domain: string; redirectTo?: string; loginHint?: string };

/** Anonymous-provider parameters. */
export type AnonymousParams = { redirectTo?: string };

/** OAuth-provider parameters. */
export type OAuthParams = { redirectTo?: string };

/** Device-provider parameters used to begin the device-code flow. */
export type DeviceParams = { redirectTo?: string };
