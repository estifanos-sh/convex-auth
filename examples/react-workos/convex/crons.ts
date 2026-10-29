import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// The webhook starts a sync as soon as WorkOS has a change. The cron is the
// backstop for a missed delivery, and starts the first sync.
crons.interval(
  "sync the WorkOS directory",
  { minutes: 5 },
  internal.workos.syncWorkosDirectory,
);

export default crons;
