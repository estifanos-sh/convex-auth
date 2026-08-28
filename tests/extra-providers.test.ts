import { api } from "@convex/_generated/api";
import schema from "@convex/schema";
import { decodeJwt } from "jose";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";
import { expectSignInSession } from "./helpers";

const EMAIL = "delegated@example.com";
const PASSWORD = "44448888";
const NEW_PASSWORD = "88884444";

type TestConvex = ReturnType<typeof convexTest>;

async function signUp(t: TestConvex) {
  return expectSignInSession(
    await t.action(api.auth.signIn, {
      request: {
        provider: "delegate",
        params: { flow: "signUp", email: EMAIL, password: PASSWORD },
      },
    }),
  );
}

test("an extra provider can create an account through `auth.account.create`", async () => {
  const t = convexTest(schema);
  const tokens = await signUp(t);
  expect(tokens).not.toBeNull();
});

test("an extra provider can verify credentials through `auth.account.get`", async () => {
  const t = convexTest(schema);
  await signUp(t);

  const tokens = expectSignInSession(
    await t.action(api.auth.signIn, {
      request: {
        provider: "delegate",
        params: { flow: "check", email: EMAIL, password: PASSWORD },
      },
    }),
  );
  expect(tokens).not.toBeNull();
});

test("an extra provider can verify credentials through the credentials sign-in mutation", async () => {
  const t = convexTest(schema);
  await signUp(t);

  const tokens = expectSignInSession(
    await t.action(api.auth.signIn, {
      request: {
        provider: "delegate",
        params: { flow: "signIn", email: EMAIL, password: PASSWORD },
      },
    }),
  );
  expect(tokens).not.toBeNull();
});

test("an extra provider can rewrite its secret through `auth.account.update`", async () => {
  const t = convexTest(schema);
  const signedUp = await signUp(t);
  const claims = decodeJwt(signedUp!.token);
  const asUser = t.withIdentity({ subject: claims.sub, sid: claims.sid as any });

  expectSignInSession(
    await asUser.action(api.auth.signIn, {
      request: {
        provider: "delegate",
        params: {
          flow: "change",
          email: EMAIL,
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
        },
      },
    }),
  );

  const tokens = expectSignInSession(
    await t.action(api.auth.signIn, {
      request: {
        provider: "delegate",
        params: { flow: "signIn", email: EMAIL, password: NEW_PASSWORD },
      },
    }),
  );
  expect(tokens).not.toBeNull();
});
