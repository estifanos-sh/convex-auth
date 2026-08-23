import { webauthn } from "@estifanos-sh/convex-auth/providers/webauthn";
import { createCoreDomains } from "@estifanos-sh/convex-auth/server/core";
import { expect, test, vi } from "vite-plus/test";

const CONTINUATION = {
  kind: "webauthnOptions" as const,
  options: {},
  verifier: "verifier",
  continuation: "continuation",
  operation: "signIn" as const,
};

function credentialDomains() {
  const callCreateAccountFromCredentials = vi.fn(async () => ({
    account: { _id: "account", userId: "user" },
    user: {},
  }));
  const callGetAccountWithCredentials = vi.fn(
    async (): Promise<
      | { account: { _id: string; userId: string }; user: Record<string, never> }
      | "InvalidAccountId"
      | "InvalidSecret"
      | "TooManyFailedAttempts"
    > => ({
      account: { _id: "account", userId: "user" },
      user: {},
    }),
  );
  const continueWithProvider = vi.fn(async () => CONTINUATION);
  const stageCredentialEnrollment = vi.fn(async () => CONTINUATION);
  const domains = createCoreDomains({
    config: { permissions: { roles: {} } },
    callRevokeSessions: vi.fn(),
    callCreateAccountFromCredentials,
    callGetAccountWithCredentials,
    callUpdateAccount: vi.fn(),
    getEnrichCtx: () => (ctx: unknown) => ctx,
    inviteTokenAlphabet: "test",
    inviteTokenLength: 1,
    signInForProvider: vi.fn(),
    continueWithProvider,
    stageCredentialEnrollment,
  } as never);
  return {
    domains,
    callCreateAccountFromCredentials,
    callGetAccountWithCredentials,
    continueWithProvider,
    stageCredentialEnrollment,
  };
}

test("credentials.verify binds a verified credentials account to passkey sign-in", async () => {
  const passkeys = webauthn();
  const verifier = {
    id: "pin",
    type: "credentials",
    params: {},
    authorize: async () => null,
  } as never;
  const { domains, callGetAccountWithCredentials, continueWithProvider } = credentialDomains();

  const result = await domains.credentials.verify({} as never, {
    verifier,
    account: { id: "member@example.com", secret: "1234" },
    operation: passkeys.signIn(),
  });

  expect(result).toBe(CONTINUATION);
  expect(callGetAccountWithCredentials).toHaveBeenCalledWith(expect.anything(), {
    provider: "pin",
    account: { id: "member@example.com", secret: "1234" },
  });
  expect(continueWithProvider).toHaveBeenCalledWith(expect.anything(), {
    userId: "user",
    operation: passkeys.signIn(),
  });
});

test("credentials.provision stages a missing account before passkey rotation", async () => {
  const passkeys = webauthn();
  const verifier = {
    id: "pin",
    type: "credentials",
    params: {},
    authorize: async () => null,
  } as never;
  const {
    domains,
    callCreateAccountFromCredentials,
    callGetAccountWithCredentials,
    continueWithProvider,
    stageCredentialEnrollment,
  } = credentialDomains();
  callGetAccountWithCredentials.mockResolvedValueOnce("InvalidAccountId");

  await domains.credentials.provision({} as never, {
    verifier,
    account: { id: "member@example.com", secret: "1234" },
    profile: { email: "member@example.com", name: "Member" },
    match: ["email"],
    operation: passkeys.rotate(),
  });

  expect(callCreateAccountFromCredentials).not.toHaveBeenCalled();
  expect(stageCredentialEnrollment).toHaveBeenCalledWith(expect.anything(), {
    verifier,
    account: { id: "member@example.com", secret: "1234" },
    profile: { email: "member@example.com", name: "Member" },
    shouldLinkViaEmail: true,
    shouldLinkViaPhone: false,
    operation: passkeys.rotate(),
  });
  expect(continueWithProvider).not.toHaveBeenCalled();
});

test("credentials.provision reuses a verified existing account continuation", async () => {
  const passkeys = webauthn();
  const verifier = {
    id: "pin",
    type: "credentials",
    params: {},
    authorize: async () => null,
  } as never;
  const { domains, continueWithProvider, stageCredentialEnrollment } = credentialDomains();

  await domains.credentials.provision({} as never, {
    verifier,
    account: { id: "member@example.com", secret: "1234" },
    profile: { email: "member@example.com", name: "Member" },
    operation: passkeys.rotate(),
  });

  expect(continueWithProvider).toHaveBeenCalledWith(expect.anything(), {
    userId: "user",
    operation: passkeys.rotate(),
  });
  expect(stageCredentialEnrollment).not.toHaveBeenCalled();
});
