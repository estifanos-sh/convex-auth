import { type ReactNode, useEffect, useState } from "react";
import { useConvex, useConvexAuth, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useAuthActions } from "@convex-dev/auth/react";
import { useProvisionedSignInWithWorkos } from "@estifanos-sh/convex-workos/react";
import { api } from "../convex/_generated/api";

/**
 * A failure to start comes back from the sign-in call, and a failure after the
 * redirect back shows up in the hook's `flowError`. Each is handled with an
 * exhaustive switch on its code. While the server waits for the directory
 * sync to provision a new user, the hook holds the sign-in's ticket, and the
 * page finishes it every two seconds until the session arrives.
 */
function SignedOut(): ReactNode {
  const { signIn, finish, flowError, deferredTicket } =
    useProvisionedSignInWithWorkos(api.auth);
  const convex = useConvex();
  const [email, setEmail] = useState("");
  const [startError, setStartError] = useState<string | null>(null);
  useEffect(() => {
    if (deferredTicket === null) return;
    const timer = setInterval(() => void finish(deferredTicket), 2000);
    return () => clearInterval(timer);
  }, [deferredTicket, finish]);
  if (deferredTicket !== null) {
    return <p>Setting up your account…</p>;
  }
  return (
    <>
      <h1>Sign in</h1>
      <p>Sign in with your work email</p>
      {flowError !== null && (
        <p role="alert">
          <strong>
            {(() => {
              switch (flowError.error) {
                case "ACCESS_DENIED":
                  return "Sign-in was cancelled.";
                case "EXPIRED":
                  return "That sign-in took too long. Please try again.";
                case "INVALID_FLOW":
                  return "This sign-in can't be completed here. Please try again.";
                case "OTHER_ERROR":
                  // `onSignIn` refuses a deprovisioned user with a
                  // ConvexError, which arrives as the `cause`.
                  if (
                    flowError.cause instanceof ConvexError &&
                    typeof flowError.cause.data === "string"
                  ) {
                    return flowError.cause.data;
                  }
                  return "Something went wrong during sign-in. Please try again.";
                default:
                  flowError satisfies never;
                  return `Unknown error: ${JSON.stringify(flowError)}`;
              }
            })()}
          </strong>
        </p>
      )}
      {startError !== null && (
        <p role="alert">
          <strong>{startError}</strong>
        </p>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setStartError(null);
          const route = await convex.query(api.workos.route, { email });
          if (route === null) {
            setStartError("Your organization doesn't sign in with SSO.");
            return;
          }
          const result = await signIn({
            route: {
              kind: "organization",
              organizationId: route.organizationId,
              loginHint: email,
            },
          });
          if (result.status === "redirect") return;
          switch (result.userError.error) {
            case "OTHER_ERROR":
              // The flow couldn't start, e.g. the deployment was
              // unreachable. The original error is on `cause` if you want
              // to log or inspect it.
              console.error(
                "SSO sign-in failed to start:",
                result.userError.cause,
              );
              setStartError("Couldn't start SSO sign-in. Please try again.");
              return;
            default:
              result.userError.error satisfies never;
              console.error("SSO sign-in failed to start:", result.userError);
              setStartError("Couldn't start SSO sign-in. Please try again.");
          }
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          required
        />
        <button type="submit">Continue with SSO</button>
      </form>
    </>
  );
}

function SignedIn(): ReactNode {
  const { signOut } = useAuthActions();
  const user = useQuery(api.users.getCurrentUser);
  return (
    <>
      <h1>Signed in</h1>
      <p>{user?.email ?? "…"}</p>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </>
  );
}

export default function App(): ReactNode {
  const { isLoading, isAuthenticated } = useConvexAuth();
  return (
    <main>
      {isLoading && <p>Signing you in…</p>}
      {!isLoading && isAuthenticated && <SignedIn />}
      {!isLoading && !isAuthenticated && <SignedOut />}
    </main>
  );
}
