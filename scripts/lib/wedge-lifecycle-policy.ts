export type WedgeStage = "validation" | "traction" | "scale" | "stalled" | "parked";

export interface WedgeSignals {
  signups7d: number;
  signups21d: number;
  content7d: number;
  content21d: number;
  orders7d: number;
  orders21d: number;
  inbox7d: number;
  inbox21d: number;
}

export interface WedgeLifecycleDecision {
  stage: WedgeStage;
  status: "active" | "on_hold" | "archived";
  reason: string;
}

export function decideWedgeLifecycle(
  currentStage: string,
  ageDays: number,
  signals: WedgeSignals,
): WedgeLifecycleDecision {
  const fresh7d = signals.signups7d + signals.content7d + signals.orders7d + signals.inbox7d;
  const fresh21d = signals.signups21d + signals.content21d + signals.orders21d + signals.inbox21d;

  if (signals.orders21d >= 3 || signals.signups7d >= 15) {
    return {
      stage: "scale",
      status: "active",
      reason: signals.orders21d >= 3
        ? `${signals.orders21d} paid orders/21d`
        : `${signals.signups7d} signups/7d`,
    };
  }
  if (signals.orders7d > 0 || signals.signups7d >= 5) {
    return {
      stage: "traction",
      status: "active",
      reason: signals.orders7d > 0
        ? `${signals.orders7d} paid order(s)/7d`
        : `${signals.signups7d} signups/7d`,
    };
  }
  if ((currentStage === "stalled" || currentStage === "parked") && fresh7d > 0) {
    return { stage: "validation", status: "active", reason: "fresh signal returned" };
  }
  if (currentStage === "parked") {
    return { stage: "parked", status: "archived", reason: "no fresh signal" };
  }
  if (fresh21d === 0 && ageDays >= 42) {
    return { stage: "parked", status: "archived", reason: "zero signals for 42d" };
  }
  if (currentStage === "stalled") {
    return { stage: "stalled", status: "on_hold", reason: "no fresh signal" };
  }
  if (fresh21d === 0 && ageDays >= 21) {
    return { stage: "stalled", status: "on_hold", reason: "zero signals for 21d" };
  }
  const normalized = ["validation", "traction", "scale"].includes(currentStage)
    ? currentStage as WedgeStage
    : "validation";
  return { stage: normalized, status: "active", reason: "holding" };
}
