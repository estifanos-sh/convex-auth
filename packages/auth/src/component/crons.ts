/**
 * Component-internal scheduled jobs.
 *
 * @module
 */

import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "auth-prune-expired",
  { hourUTC: 3, minuteUTC: 0 },
  internal.maintenance.pruneExpired,
  {},
);

/**
 * Hard-delete OAuth clients only after their audit-retention window. The
 * mutation self-reschedules in bounded batches when a backlog remains.
 */
crons.daily(
  "auth-prune-oauth-clients",
  { hourUTC: 3, minuteUTC: 30 },
  internal.oauth.client.prune,
  {},
);

export default crons;
