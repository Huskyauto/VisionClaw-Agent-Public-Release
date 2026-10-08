/**
 * A late-arriving older fact belongs in the historical interval before the
 * current one; it must not make a newer fact disappear or give it a negative
 * validity interval. Explicitly ended facts must not displace current facts.
 */
export function planTripleValidity(
  validFrom: Date,
  requestedValidUntil: Date | null,
  activeStarts: Date[],
  now: Date = new Date(),
): { validUntil: Date | null; supersedeCurrent: boolean } {
  if (requestedValidUntil && requestedValidUntil <= validFrom) {
    throw new Error("valid_until must be after valid_from");
  }

  const nextStart = activeStarts
    .filter((start) => start > validFrom)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  if (nextStart) {
    return {
      validUntil: requestedValidUntil && requestedValidUntil < nextStart
        ? requestedValidUntil : nextStart,
      supersedeCurrent: false,
    };
  }

  return {
    validUntil: requestedValidUntil,
    supersedeCurrent: !requestedValidUntil || requestedValidUntil > now,
  };
}