/**
 * Regression: concurrent / duplicate passkey registration must not create two
 * rows for the same `credentialId`.
 *
 * A duplicate row makes `factor.passkey.get({ credentialId })` (a `.unique()`
 * lookup) throw on every later sign-in — a permanent lockout for that
 * credential. `factor.passkey.create` now dedups by `credentialId`: idempotent
 * for the same user, rejected with `ACCOUNT_ALREADY_LINKED` for a different one.
 *
 * `convex-test` runs mutations serially, so this exercises the dedup *logic*
 * (the observable outcome of the OCC-serialized race), not literal concurrency.
 */

import { components } from "@convex/_generated/api";
import schema from "@convex/schema";
import { ConvexError } from "convex/values";
import { expect, test } from "vite-plus/test";

import { ErrorCode } from "../packages/auth/src/shared/codes";
import { MAX_WEBAUTHN_CREDENTIALS_PER_USER } from "../packages/auth/src/shared/webauthn";
import { convexTest } from "./convex/setup";

const CREDENTIAL_ID = "dedup-credential";

type AccountRecord = {
  provider: string;
  providerAccountId: string;
};

function passkeyArgs(userId: string) {
  return {
    userId: userId as never,
    credentialId: CREDENTIAL_ID,
    publicKey: new ArrayBuffer(32),
    algorithm: -7,
    counter: 0,
    deviceType: "multiDevice",
    backedUp: true,
    createdAt: Date.now(),
  };
}

test("duplicate passkey registration for the same user is idempotent", async () => {
  const t = convexTest(schema);

  const userId = await t.run(async (ctx) => {
    return (await ctx.runMutation(components.auth.user.create, {
      data: { email: "dedup@example.com" },
    })) as string;
  });

  const first = await t.run(async (ctx) => {
    return (await ctx.runMutation(
      components.auth.factor.passkey.create,
      passkeyArgs(userId),
    )) as string;
  });
  const second = await t.run(async (ctx) => {
    return (await ctx.runMutation(
      components.auth.factor.passkey.create,
      passkeyArgs(userId),
    )) as string;
  });

  // Same credential id + same user → same row, no duplicate insert.
  expect(second).toBe(first);

  // The single-row invariant holds: get({ credentialId }).unique() must not throw.
  const found = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.factor.passkey.get, {
      credentialId: CREDENTIAL_ID,
    });
  });
  expect(found).not.toBeNull();
  expect((found as { _id: string })._id).toBe(first);

  const all = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.factor.passkey.list, {
      userId: userId as never,
    });
  });
  expect(all.length).toBe(1);
  const accounts = await t.run((ctx) =>
    ctx.runQuery(components.auth.account.list, { userId: userId as never }),
  );
  expect(
    accounts.filter(
      (account: AccountRecord) =>
        account.provider === "passkey" && account.providerAccountId === CREDENTIAL_ID,
    ),
  ).toHaveLength(1);
});

test("trusted re-registration upgrades an existing legacy passkey row", async () => {
  const t = convexTest(schema);
  const userId = await t.run((ctx) =>
    ctx.runMutation(components.auth.user.create, {
      data: { email: "attestation-upgrade@example.com" },
    }),
  );
  const first = await t.run((ctx) =>
    ctx.runMutation(components.auth.factor.passkey.create, passkeyArgs(userId)),
  );
  const attestation = {
    verifier: "fido-mds-v3",
    aaguid: "2fc0579f-8113-47ea-b116-bb5a8db9202a",
    format: "packed",
    metadataDescription: "YubiKey 5 NFC",
    verifiedAt: Date.now(),
    status: "trusted" as const,
  };

  const second = await t.run((ctx) =>
    ctx.runMutation(components.auth.factor.passkey.create, {
      ...passkeyArgs(userId),
      attestation,
    }),
  );
  const stored = await t.run((ctx) =>
    ctx.runQuery(components.auth.factor.passkey.get, { id: first }),
  );

  expect(second).toBe(first);
  expect(stored?.attestation).toEqual(attestation);
});

test("registering an existing credential for a different user is rejected", async () => {
  const t = convexTest(schema);

  const { alice, bob } = await t.run(async (ctx) => {
    const alice = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "alice@example.com" },
    })) as string;
    const bob = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "bob@example.com" },
    })) as string;
    return { alice, bob };
  });

  await t.run(async (ctx) => {
    await ctx.runMutation(components.auth.factor.passkey.create, passkeyArgs(alice));
  });

  const error = await t
    .run(async (ctx) => {
      return await ctx.runMutation(components.auth.factor.passkey.create, passkeyArgs(bob));
    })
    .then(
      () => null,
      (e) => e,
    );
  expect(error).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe("ACCOUNT_ALREADY_LINKED");

  // Still exactly one row — Bob's rejected insert did not create a duplicate,
  // and it still belongs to Alice.
  const found = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.factor.passkey.get, {
      credentialId: CREDENTIAL_ID,
    });
  });
  expect((found as { userId: string }).userId).toBe(alice);
  const bobAccounts = await t.run((ctx) =>
    ctx.runQuery(components.auth.account.list, { userId: bob as never }),
  );
  expect(bobAccounts).toHaveLength(0);
});

test("a user cannot register more credentials than email sign-in can offer", async () => {
  const t = convexTest(schema);
  const userId = await t.run((ctx) =>
    ctx.runMutation(components.auth.user.create, {
      data: { email: "credential-limit@example.com" },
    }),
  );

  const firstId = await t.run(async (ctx) => {
    let firstId: string | null = null;
    for (let index = 0; index < MAX_WEBAUTHN_CREDENTIALS_PER_USER; index++) {
      const id = (await ctx.runMutation(components.auth.factor.passkey.create, {
        ...passkeyArgs(userId),
        credentialId: `credential-limit-${index}`,
      })) as string;
      if (index === 0) firstId = id;
    }
    return firstId;
  });

  await expect(
    t.run((ctx) =>
      ctx.runMutation(components.auth.factor.passkey.create, {
        ...passkeyArgs(userId),
        credentialId: "credential-limit-overflow",
      }),
    ),
  ).rejects.toMatchObject({
    data: { code: ErrorCode.INVALID_PARAMETERS },
  });

  const duplicate = await t.run((ctx) =>
    ctx.runMutation(components.auth.factor.passkey.create, {
      ...passkeyArgs(userId),
      credentialId: "credential-limit-0",
    }),
  );
  expect(duplicate).toBe(firstId);
});

test("passkey assertion counter acceptance rejects a stale concurrent counter", async () => {
  const t = convexTest(schema);
  const { userId, passkeyId } = await t.run(async (ctx) => {
    const userId = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "counter-race@example.com" },
    })) as string;
    const passkeyId = (await ctx.runMutation(components.auth.factor.passkey.create, {
      ...passkeyArgs(userId),
      credentialId: "counter-race-credential",
      counter: 10,
    })) as string;
    return { userId, passkeyId };
  });

  const first = await t.run((ctx) =>
    ctx.runMutation(components.auth.factor.passkey.acceptAssertion, {
      id: passkeyId as never,
      counter: 11,
      lastUsedAt: Date.now(),
      backedUp: true,
    }),
  );
  const stale = await t.run((ctx) =>
    ctx.runMutation(components.auth.factor.passkey.acceptAssertion, {
      id: passkeyId as never,
      counter: 11,
      lastUsedAt: Date.now() + 1,
      backedUp: false,
    }),
  );

  expect(first).toBe(true);
  expect(stale).toBe(false);
  const stored = await t.run((ctx) =>
    ctx.runQuery(components.auth.factor.passkey.get, { id: passkeyId as never }),
  );
  expect(stored?.counter).toBe(11);
  expect(stored?.backedUp).toBe(true);
  expect(stored?.userId).toBe(userId);
});

test("positive passkey counter cannot regress to zero", async () => {
  const t = convexTest(schema);
  const passkeyId = await t.run(async (ctx) => {
    const userId = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "counter-zero@example.com" },
    })) as string;
    return (await ctx.runMutation(components.auth.factor.passkey.create, {
      ...passkeyArgs(userId),
      credentialId: "counter-zero-credential",
      counter: 4,
      backedUp: false,
    })) as string;
  });

  const accepted = await t.run((ctx) =>
    ctx.runMutation(components.auth.factor.passkey.acceptAssertion, {
      id: passkeyId as never,
      counter: 0,
      lastUsedAt: Date.now(),
      backedUp: true,
    }),
  );
  expect(accepted).toBe(false);
  const stored = await t.run((ctx) =>
    ctx.runQuery(components.auth.factor.passkey.get, { id: passkeyId as never }),
  );
  expect(stored?.counter).toBe(4);
  expect(stored?.backedUp).toBe(false);
});

test("passkey assertion begin consumes its challenge and loads the credential atomically", async () => {
  const t = convexTest(schema);
  const { verifierId, passkeyId } = await t.run(async (ctx) => {
    const userId = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "assertion-begin@example.com" },
    })) as string;
    const passkeyId = (await ctx.runMutation(components.auth.factor.passkey.create, {
      ...passkeyArgs(userId),
      credentialId: "assertion-begin-credential",
    })) as string;
    const verifierId = (await ctx.runMutation(components.auth.token.pkce.create, {
      signature: "challenge-hash",
      expirationTime: Date.now() + 60_000,
    })) as string;
    return { verifierId, passkeyId };
  });

  const first = await t.run((ctx) =>
    ctx.runMutation(components.auth.factor.passkey.beginAssertion, {
      verifierId: verifierId as never,
      expectedChallenge: "challenge-hash",
      credentialId: "assertion-begin-credential",
    }),
  );
  expect(first.verifierAccepted).toBe(true);
  expect(first.passkey?._id).toBe(passkeyId);

  const replay = await t.run((ctx) =>
    ctx.runMutation(components.auth.factor.passkey.beginAssertion, {
      verifierId: verifierId as never,
      expectedChallenge: "challenge-hash",
      credentialId: "assertion-begin-credential",
    }),
  );
  expect(replay.verifierAccepted).toBe(false);
});

test("passkey assertion begin preserves a challenge when the response does not match", async () => {
  const t = convexTest(schema);
  const verifierId = await t.run((ctx) =>
    ctx.runMutation(components.auth.token.pkce.create, {
      signature: "expected-challenge-hash",
      expirationTime: Date.now() + 60_000,
    }),
  );

  const mismatch = await t.run((ctx) =>
    ctx.runMutation(components.auth.factor.passkey.beginAssertion, {
      verifierId,
      expectedChallenge: "different-challenge-hash",
      credentialId: "unknown-credential",
    }),
  );
  expect(mismatch).toEqual({ verifierAccepted: false, passkey: null });

  const valid = await t.run((ctx) =>
    ctx.runMutation(components.auth.factor.passkey.beginAssertion, {
      verifierId,
      expectedChallenge: "expected-challenge-hash",
      credentialId: "unknown-credential",
    }),
  );
  expect(valid).toEqual({ verifierAccepted: true, passkey: null });
});

test("passkey assertion completion accepts the counter and creates one session atomically", async () => {
  const t = convexTest(schema);
  const { userId, passkeyId } = await t.run(async (ctx) => {
    const userId = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "assertion-complete@example.com" },
    })) as string;
    const passkeyId = (await ctx.runMutation(components.auth.factor.passkey.create, {
      ...passkeyArgs(userId),
      credentialId: "assertion-complete-credential",
      counter: 20,
    })) as string;
    return { userId, passkeyId };
  });

  const first = await t.run((ctx) =>
    ctx.runMutation(components.auth.factor.passkey.completeAssertion, {
      id: passkeyId as never,
      counter: 21,
      lastUsedAt: Date.now(),
      backedUp: true,
      sessionExpirationTime: Date.now() + 60_000,
      refreshTokenExpirationTime: Date.now() + 120_000,
    }),
  );
  expect(first.status).toBe("accepted");

  const stale = await t.run((ctx) =>
    ctx.runMutation(components.auth.factor.passkey.completeAssertion, {
      id: passkeyId as never,
      counter: 21,
      lastUsedAt: Date.now() + 1,
      backedUp: false,
      sessionExpirationTime: Date.now() + 60_000,
      refreshTokenExpirationTime: Date.now() + 120_000,
    }),
  );
  expect(stale).toEqual({ status: "rejected" });

  const sessions = await t.run((ctx) =>
    ctx.runQuery(components.auth.session.list, { userId: userId as never }),
  );
  expect(sessions).toHaveLength(1);
  expect(sessions[0]?._id).toBe(first.status === "accepted" ? first.sessionId : undefined);
});

test("phantom Account blocks registration before a Passkey is created", async () => {
  const t = convexTest(schema);
  const { owner, registrant } = await t.run(async (ctx) => {
    const owner = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "phantom-owner@example.com" },
    })) as string;
    const registrant = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "phantom-registrant@example.com" },
    })) as string;
    await ctx.runMutation(components.auth.account.create, {
      userId: owner as never,
      provider: "passkey",
      providerAccountId: "phantom-credential",
    });
    return { owner, registrant };
  });

  await expect(
    t.run((ctx) =>
      ctx.runMutation(components.auth.factor.passkey.create, {
        ...passkeyArgs(registrant),
        credentialId: "phantom-credential",
      }),
    ),
  ).rejects.toMatchObject({
    data: { code: ErrorCode.ACCOUNT_ALREADY_LINKED },
  });
  const passkey = await t.run((ctx) =>
    ctx.runQuery(components.auth.factor.passkey.get, {
      credentialId: "phantom-credential",
    }),
  );
  expect(passkey).toBeNull();
  expect(owner).not.toBe(registrant);
});

test("removing a Passkey also removes legacy and stray canonical Account rows", async () => {
  const t = convexTest(schema);
  const { userId, passkeyId } = await t.run(async (ctx) => {
    const userId = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "remove-passkey@example.com" },
    })) as string;
    const passkeyId = (await ctx.runMutation(components.auth.factor.passkey.create, {
      ...passkeyArgs(userId),
      credentialId: "remove-credential",
    })) as string;
    await ctx.runMutation(components.auth.account.create, {
      userId: userId as never,
      provider: "webauthn",
      providerAccountId: "remove-credential",
    });
    return { userId, passkeyId };
  });

  await t.run((ctx) =>
    ctx.runMutation(components.auth.factor.passkey.remove, { id: passkeyId as never }),
  );
  const accounts = await t.run((ctx) =>
    ctx.runQuery(components.auth.account.list, { userId: userId as never }),
  );
  expect(
    accounts.filter((account: AccountRecord) => account.providerAccountId === "remove-credential"),
  ).toHaveLength(0);
});
