/**
 * Shared quota-observation retention bound. The calibration estimator reads a
 * 45-day window; keeping 60 days leaves debugging slack while bounding history.
 * Every writer, sweeper, and reader uses this same horizon so a delayed cached
 * observation cannot outlive or re-enter calibration through another path.
 */
export const USAGE_SNAPSHOT_RETENTION_DAYS = 60;
export const USAGE_SNAPSHOT_RETENTION_MS =
  USAGE_SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
