/** Resolve a user's revocation epoch across pre-epoch and current rows. */
export function getUserEpoch(value: { sessionEpoch?: number }): number {
  return value.sessionEpoch ?? 0;
}

/** Resolve a session's issuance epoch across pre-epoch and current rows. */
export function getSessionEpoch(value: { epoch?: number }): number {
  return value.epoch ?? 0;
}
