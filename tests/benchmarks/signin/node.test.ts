/**
 * Sign-in latency benchmark — measures `auth:signIn` end-to-end wall time
 * against the local Docker Convex backend (booted by
 * `tests/infra/docker/setup/node.ts`).
 *
 * Why exist: the dashboard gives per-function wall time but not stable
 * aggregates. CI needs p50 / p95 numbers we can compare over time. This
 * test locks in baseline numbers and fails loudly if a future change
 * blows past the budget.
 *
 * Two lenses:
 *
 * 1. **Client wall time** — measured around `ConvexHttpClient.action()`
 *    on the test process. Includes HTTP RTT, serialization, and the
 *    Convex action dispatch.
 * 2. **Backend wall time** — measured inside a thin wrapper action in
 *    `convex/bench.ts`. Excludes the client→backend HTTP hop, so the
 *    delta (client − backend) is pure transport.
 *
 * Two sign-in flavors:
 *
 * - **Anonymous** — baseline. No password hashing. Surfaces the cost of
 *   the sign-in *envelope*: provider dispatch, session insert, refresh
 *   token issue, RSA JWT sign.
 * - **Password** — real-world. Adds scrypt verify (~50–150ms of CPU) on
 *   top of the envelope.
 *
 * The delta between the two roughly equals the scrypt cost.
 *
 * Budgets are intentionally loose; tighten them once we have a few CI
 * runs' worth of data.
 */

import { api } from "@convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { beforeAll, expect, inject, test } from "vite-plus/test";

type BatchResult = { backendMs: number[]; totalMs: number };
const benchAnonymousBatch = makeFunctionReference<"action", { iterations: number }, BatchResult>(
  "bench:anonymousSignInBatch",
);
const benchPasswordBatch = makeFunctionReference<
  "action",
  { email: string; password: string; iterations: number },
  BatchResult
>("bench:passwordSignInBatch");
const seedWebAuthnUser = makeFunctionReference<
  "action",
  { email: string; credentialId: string },
  null
>("bench:seedWebAuthnUser");
const benchWebAuthnOptionsBatch = makeFunctionReference<
  "action",
  { email: string; iterations: number },
  BatchResult
>("bench:webAuthnOptionsBatch");
const benchLegacyWebAuthnOptionsBatch = makeFunctionReference<
  "action",
  { email: string; iterations: number },
  BatchResult
>("bench:legacyWebAuthnOptionsBatch");
const benchWebAuthnOptionTransactionBatch = makeFunctionReference<
  "action",
  { email: string; iterations: number },
  BatchResult
>("bench:webAuthnOptionTransactionBatch");

type SignInEnvelope = {
  kind: string;
  tokens?: { token: string; refreshToken: string } | null;
  session?: { tokens: { token: string; refreshToken: string } | null } | null;
};

const N_ITERATIONS = Number.parseInt(process.env.BENCH_ITERATIONS ?? "20", 10);
const PASSWORD = "bench-password-!";
const BENCH_EMAIL = `bench-${Date.now().toString(36)}@example.com`;
const WEBAUTHN_EMAIL = `webauthn-${Date.now().toString(36)}@example.com`;

declare module "vite-plus/test" {
  interface ProvidedContext {
    convexSelfHostedUrl: string;
  }
}

function createClient() {
  return new ConvexHttpClient(inject("convexSelfHostedUrl"), {
    skipConvexDeploymentUrlCheck: true,
    logger: false,
  });
}

type Stats = {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  min: number;
  cold: number;
};

function stats(samples: readonly number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const q = (p: number) => sorted[Math.min(n - 1, Math.floor(p * (n - 1)))]!;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: n,
    mean: sum / n,
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    min: sorted[0]!,
    max: sorted[n - 1]!,
    cold: samples[0]!,
  };
}

function fmt(ms: number) {
  return `${ms.toFixed(1).padStart(6)}ms`;
}

function printRow(label: string, s: Stats) {
  console.log(
    `  ${label.padEnd(34)} n=${String(s.count).padEnd(3)} ` +
      `cold=${fmt(s.cold)}  p50=${fmt(s.p50)}  p95=${fmt(s.p95)}  ` +
      `p99=${fmt(s.p99)}  max=${fmt(s.max)}  mean=${fmt(s.mean)}`,
  );
}

beforeAll(async () => {
  const client = createClient();
  const result = (await client.action(api.auth.signIn, {
    provider: "password",
    params: { email: BENCH_EMAIL, password: PASSWORD, flow: "signUp" },
  })) as SignInEnvelope;
  const tokens = result.session ?? null;
  if (result.kind !== "signedIn" || tokens === null) {
    throw new Error(`Unable to create bench password account: ${JSON.stringify(result)}`);
  }
  await client.action(seedWebAuthnUser, {
    email: WEBAUTHN_EMAIL,
    credentialId: `bench-credential-${Date.now().toString(36)}`,
  });
}, 30_000);

test("auth:signIn baseline — anonymous", async () => {
  const client = createClient();

  const clientSamples: number[] = [];
  for (let i = 0; i < N_ITERATIONS; i += 1) {
    const t0 = performance.now();
    await client.action(api.auth.signIn, { provider: "anonymous" });
    clientSamples.push(performance.now() - t0);
  }

  const backend = await client.action(benchAnonymousBatch, {
    iterations: N_ITERATIONS,
  });

  console.log(`\nauth:signIn anonymous (n=${N_ITERATIONS})`);
  printRow("client wall time", stats(clientSamples));
  printRow("backend wall time (bench wrap)", stats(backend.backendMs));
  const transportOverhead = stats(clientSamples).p50 - stats(backend.backendMs).p50;
  console.log(
    `  transport overhead (client p50 − backend p50) = ${transportOverhead.toFixed(1)}ms`,
  );

  expect(stats(clientSamples).p95).toBeLessThan(1000);
  expect(stats(backend.backendMs).p95).toBeLessThan(800);
}, 120_000);

test("auth:signIn — password (scrypt verify)", async () => {
  const client = createClient();

  const clientSamples: number[] = [];
  for (let i = 0; i < N_ITERATIONS; i += 1) {
    const t0 = performance.now();
    await client.action(api.auth.signIn, {
      provider: "password",
      params: { email: BENCH_EMAIL, password: PASSWORD, flow: "signIn" },
    });
    clientSamples.push(performance.now() - t0);
  }

  const backend = await client.action(benchPasswordBatch, {
    email: BENCH_EMAIL,
    password: PASSWORD,
    iterations: N_ITERATIONS,
  });

  console.log(`\nauth:signIn password (n=${N_ITERATIONS})`);
  printRow("client wall time", stats(clientSamples));
  printRow("backend wall time (bench wrap)", stats(backend.backendMs));
  const transportOverhead = stats(clientSamples).p50 - stats(backend.backendMs).p50;
  console.log(
    `  transport overhead (client p50 − backend p50) = ${transportOverhead.toFixed(1)}ms`,
  );

  expect(stats(clientSamples).p95).toBeLessThan(1500);
  expect(stats(backend.backendMs).p95).toBeLessThan(1200);
}, 180_000);

test("auth:signIn — WebAuthn options", async () => {
  const client = createClient();

  const clientSamples: number[] = [];
  for (let i = 0; i < N_ITERATIONS; i += 1) {
    const t0 = performance.now();
    await client.action(api.auth.signIn, {
      provider: "webauthn",
      params: { email: WEBAUTHN_EMAIL, flow: "signIn" },
    });
    clientSamples.push(performance.now() - t0);
  }

  const backend = await client.action(benchWebAuthnOptionsBatch, {
    email: WEBAUTHN_EMAIL,
    iterations: N_ITERATIONS,
  });
  const legacy = await client.action(benchLegacyWebAuthnOptionsBatch, {
    email: WEBAUTHN_EMAIL,
    iterations: N_ITERATIONS,
  });
  const optimizedTransactions = await client.action(benchWebAuthnOptionTransactionBatch, {
    email: WEBAUTHN_EMAIL,
    iterations: N_ITERATIONS,
  });

  console.log(`\nauth:signIn WebAuthn options (n=${N_ITERATIONS})`);
  printRow("client wall time", stats(clientSamples));
  printRow("backend wall time (bench wrap)", stats(backend.backendMs));
  printRow("optimized 1-transaction chain", stats(optimizedTransactions.backendMs));
  printRow("legacy 3-transaction chain", stats(legacy.backendMs));
  const transportOverhead = stats(clientSamples).p50 - stats(backend.backendMs).p50;
  const transactionSavings =
    stats(legacy.backendMs).p50 - stats(optimizedTransactions.backendMs).p50;
  console.log(
    `  transport overhead (client p50 − backend p50) = ${transportOverhead.toFixed(1)}ms`,
  );
  console.log(
    `  transaction reduction (legacy p50 − optimized p50) = ${transactionSavings.toFixed(1)}ms`,
  );

  expect(stats(clientSamples).p95).toBeLessThan(800);
  expect(stats(backend.backendMs).p95).toBeLessThan(600);
}, 120_000);

test("scrypt cost = password backend p50 − anonymous backend p50", async () => {
  const client = createClient();
  const [anon, pw] = await Promise.all([
    client.action(benchAnonymousBatch, { iterations: N_ITERATIONS }),
    client.action(benchPasswordBatch, {
      email: BENCH_EMAIL,
      password: PASSWORD,
      iterations: N_ITERATIONS,
    }),
  ]);

  const anonP50 = stats(anon.backendMs).p50;
  const pwP50 = stats(pw.backendMs).p50;
  const deltaMs = pwP50 - anonP50;

  console.log(`\nScrypt cost attribution`);
  console.log(`  anonymous backend p50 = ${fmt(anonP50)}`);
  console.log(`  password  backend p50 = ${fmt(pwP50)}`);
  console.log(`  delta (≈ scrypt verify cost) = ${deltaMs.toFixed(1)}ms`);

  expect(deltaMs).toBeGreaterThan(5);
}, 180_000);
