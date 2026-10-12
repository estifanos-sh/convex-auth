import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// A sync with nothing new reads one row and makes one WorkOS call, so it can
// run often.
crons.interval(
  "workos directory sync",
  { minutes: 1 },
  internal.workos.sync,
  {},
);

export default crons;
