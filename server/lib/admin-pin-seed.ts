import { normalizeAdminPin } from "./admin-pin-normalization";

export type AdminPinSeedPlan = {
  expectedHash: string | null;
  desiredHash: string;
  reason: "bootstrap" | "stale-seed" | "untrimmed-env";
};

export function planAdminPinSeed(
  rawEnvPin: string | undefined,
  observedHash: string | null | undefined,
  staleSeedHash: string,
  hash: (pin: string) => string,
): AdminPinSeedPlan | null {
  const rawPin = rawEnvPin || "0000";
  const defaultPin = normalizeAdminPin(rawPin) || "0000";
  const desiredHash = hash(defaultPin);

  if (!observedHash) {
    return { expectedHash: null, desiredHash, reason: "bootstrap" };
  }
  if (observedHash === staleSeedHash && desiredHash !== staleSeedHash) {
    return { expectedHash: staleSeedHash, desiredHash, reason: "stale-seed" };
  }

  const corruptUntrimmed = rawPin === defaultPin ? null : hash(rawPin);
  if (corruptUntrimmed && observedHash === corruptUntrimmed) {
    return { expectedHash: corruptUntrimmed, desiredHash, reason: "untrimmed-env" };
  }
  return null;
}