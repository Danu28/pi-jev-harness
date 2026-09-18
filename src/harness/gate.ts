/**
 * Risk + Plan gate — extracted from index.ts for testability.
 * Pure function + pi wiring split.
 */
import type { HarnessConfig, PolicyDecision, RiskDecision } from "../types.ts";
import type { PlanDecision, JevPlanStep } from "./pi-planner.ts";

export interface GateState {
  policy: PolicyDecision | null;
  risk: { decision: RiskDecision } | null;
  plan: PlanDecision | null;
  pendingState: string | null;
  pendingPlanState: string | null;
}

export interface GateResult {
  block: boolean;
  reason?: string;
  pRisk: number;
  via: string;
  step?: JevPlanStep;
}

export type Phase = "idle" | "awaitingCalibrate" | "awaitingPlan" | "ready";

export function phaseOf(s: GateState): Phase {
  if (s.pendingPlanState && s.policy && !s.plan) return "awaitingPlan";
  if (s.pendingState && !s.policy) return "awaitingCalibrate";
  if (s.policy) return "ready";
  return "idle";
}

/** Pure gate evaluation — no UI, no pi. */
export function evaluateGate(
  config: HarnessConfig,
  state: GateState,
  toolName: string,
): GateResult {
  if (toolName === "jev_calibrate" || toolName === "jev_plan" || toolName === "jev_git") {
    return { block: false, pRisk: 0, via: "pi-model" };
  }
  if (!state.policy) {
    if (state.pendingState) {
      return {
        block: true,
        reason:
          "Jev calibration pending — pi model must call jev_calibrate first (Score/Noul via pi-model).",
        pRisk: 0,
        via: "pi-model",
      };
    }
    return {
      block: true,
      reason: "No Jev calibration — cannot evaluate risk without pi-model",
      pRisk: 0,
      via: "pi-model",
    };
  }
  if (
    state.policy.needsPlan.p >= 0.5 &&
    state.policy.complexity.level !== "low" &&
    !state.plan &&
    state.pendingPlanState
  ) {
    if (toolName === "bash" || toolName === "write" || toolName === "edit") {
      return {
        block: true,
        reason: "Jev plan pending — pi model must call jev_plan first (System-Two via pi-model).",
        pRisk: state.risk?.decision.pRisk ?? 0,
        via: "pi-model",
      };
    }
  }
  let pRisk = state.risk?.decision.pRisk ?? 0;
  let via: string = state.risk?.decision.via ?? "pi-model";
  let reason: string | undefined = state.risk?.decision.reason;
  let step: JevPlanStep | undefined;

  if (state.plan) {
    const found = state.plan.steps.find((s) => s.action === toolName);
    if (found) {
      step = found;
      pRisk = Math.max(pRisk, found.risk);
      via = "pi-model:plan";
      if (found.risk >= config.thresholds.risk)
        reason = `plan step ${found.id} pRisk=${found.risk.toFixed(2)} >= ${config.thresholds.risk}`;
      if (found.needsHuman) reason = `plan step ${found.id} needsHuman — confirm`;
    }
  }
  const block =
    pRisk >= config.thresholds.risk ||
    !!state.plan?.steps.some((s) => s.needsHuman && s.action === toolName);
  return { block, reason, pRisk, via, step };
}
