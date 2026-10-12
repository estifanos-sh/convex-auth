import { type ReactNode, useState } from "react";
import { useAction, useConvex, useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  useOauth,
  useSignInWithWorkos,
} from "@convex-dev/auth/methods/workos/react";
import { api } from "../convex/_generated/api";

/**
 * A failure to start comes back from the sign-in call, and a failure after the
 * redirect back shows up in `useOauth`'s `flowError`. Each is handled with an
 * exhaustive switch on its code.
 */
function SignedOut(): ReactNode {
  const { signIn } = useSignInWithWorkos(api.auth);
  const { flowError } = useOauth();
  const convex = useConvex();
  const [startError, setStartError] = useState<string | null>(null);
  const [email, setEmail] = useState("");

  /**
   * Start the sign-in, and report a failure to start. With a work email, an
   * organization that signs in through SSO goes straight to its identity
   * provider; any other email opens AuthKit with the email filled in.
   */
  const start = async (routing: Parameters<typeof signIn>[0]) => {
    setStartError(null);
    const result = await signIn(routing);
    if (result.status === "redirect") return;
    switch (result.userError.error) {
      case "OTHER_ERROR":
        // The flow couldn't start, e.g. the deployment was unreachable or
        // the routing was refused. The original error is on `cause`.
        console.error(
          "WorkOS sign-in failed to start:",
          result.userError.cause,
        );
        setStartError("Couldn't start WorkOS sign-in. Please try again.");
        return;
      default:
        result.userError.error satisfies never;
        setStartError(`Unknown error: ` + result.userError.error);
    }
  };
  return (
    <>
      <h1>Sign in</h1>
      <p>Continue with your work account</p>
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
                case "REJECTED":
                  // Your backend rejected the sign-in with a ConvexError,
                  // and `data` is its data. Show it when it's text for the
                  // user.
                  return typeof flowError.data === "string"
                    ? flowError.data
                    : "Sign-in was declined.";
                case "OTHER_ERROR":
                  // The details are on `cause` if you want to log them.
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
          const route = await convex.query(api.workos.route, { email });
          await start(
            route === null
              ? { loginHint: email }
              : route.connection !== undefined
                ? { connectionId: route.connection }
                : { organizationId: route.organization },
          );
        }}
      >
        <input
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <button type="submit">Continue with SSO</button>
      </form>
      <button type="button" onClick={() => void start(undefined)}>
        Continue with WorkOS
      </button>
    </>
  );
}

function SignedIn(): ReactNode {
  const { signOut } = useAuthActions();
  const user = useQuery(api.users.getCurrentUser);
  const organizations = useQuery(api.workos.myOrganizations);
  const signOutEverywhere = useAction(api.workos.signOutEverywhere);
  const adminPortal = useAction(api.workos.adminPortal);
  return (
    <>
      <h1>Signed in</h1>
      <p>{user?.id ?? "…"}</p>
      {organizations?.map(({ organization, role }) => (
        <p key={organization}>
          {organization} ({role}){" "}
          {role === "admin" && (
            <button
              type="button"
              onClick={async () => {
                // An IT admin sets up their organization's SSO themselves.
                const { link } = await adminPortal({
                  organization,
                  intent: "sso",
                });
                window.location.href = link;
              }}
            >
              Set up SSO
            </button>
          )}
        </p>
      ))}
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
      <button
        type="button"
        onClick={async () => {
          // Ends the WorkOS sessions too, so the next sign-in asks again. If
          // WorkOS can't revoke them, this throws and the user stays signed in.
          await signOutEverywhere();
          await signOut();
        }}
      >
        Sign out everywhere
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
