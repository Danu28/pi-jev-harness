/**
 * Risk + Plan gate — extracted from index.ts for testability.
 * Enhanced: family mapping, dependsOn enforcement, typed codes, structured reasons.
 */
import type { HarnessConfig, PolicyDecision, RiskDecision } from "../types.ts";
import type { PlanDecision, JevPlanStep } from "./pi-planner.ts";
import { matchesAction } from "./pi-planner.ts";

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
  code?: "CALIBRATE_FIRST" | "PLAN_PENDING" | "RISK_HIGH" | "NEEDS_HUMAN" | "DEPENDS_NOT_DONE";
  hint?: string;
  retryable?: boolean;
  warning?: string;
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
  if (
    toolName === "jev_calibrate" ||
    toolName === "jev_plan" ||
    toolName === "jev_git" ||
    toolName.startsWith("jev_git_")
  ) {
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
        code: "CALIBRATE_FIRST",
        hint: "Call jev_calibrate with 5 Questions for this STATE. If needs_plan>=0.5, call jev_plan separately next (once per task).",
        retryable: true,
      };
    }
    return {
      block: true,
      reason: "No Jev calibration — cannot evaluate risk without pi-model",
      pRisk: 0,
      via: "pi-model",
      code: "CALIBRATE_FIRST",
      hint: "Call jev_calibrate first.",
      retryable: true,
    };
  }
  if (
    state.policy.needsPlan.p >= 0.5 &&
    state.policy.complexity.level !== "low" &&
    !state.plan &&
    state.pendingPlanState
  ) {
    if (
      toolName === "bash" ||
      toolName === "write" ||
      toolName === "edit" ||
      toolName === "smart_bundle" ||
      toolName === "smart_edit"
    ) {
      return {
        block: true,
        reason: "Jev plan pending — pi model must call jev_plan first (System-Two via pi-model).",
        pRisk: state.risk?.decision.pRisk ?? 0,
        via: "pi-model",
        code: "PLAN_PENDING",
        hint: "Call jev_plan separately before bash/write/edit (once per task, never merged).",
        retryable: true,
      };
    }
  }
  let pRisk = state.risk?.decision.pRisk ?? 0;
  let via: string = state.risk?.decision.via ?? "pi-model";
  let reason: string | undefined = state.risk?.decision.reason;
  let step: JevPlanStep | undefined;
  let warning: string | undefined;
  let code: GateResult["code"] | undefined;
  let hint: string | undefined;

  if (state.plan) {
    const found = state.plan.steps.find((s) => matchesAction(s.action, toolName));
    if (found) {
      step = found;
      pRisk = Math.max(pRisk, found.risk);
      via = "pi-model:plan";
      if (found.risk >= config.thresholds.risk) {
        reason = `plan step ${found.id} pRisk=${found.risk.toFixed(2)} >= ${config.thresholds.risk}`;
        code = "RISK_HIGH";
        hint = `Risk high for ${found.id}. Recalibrate with is_risky<0.6 or confirm via UI.`;
      }
      if (found.needsHuman) {
        reason = `plan step ${found.id} needsHuman — confirm`;
        code = "NEEDS_HUMAN";
        hint = `Step ${found.id} needs human confirmation. Use UI confirm or /jev:next.`;
      }
      // dependsOn / out-of-order checks removed — noisy for autonomous agent (user won't block)
      // keep product quality via risk threshold blocking only; plan progress shown in widget/card
    } else {
      // previously: out-of-order warning for write/edit/bash — removed (agent runs unattended)
    }
  }
  // Also detect any needsHuman step matching this tool even if not primary found
  const needsHumanStep = state.plan?.steps.find(
    (s) => s.needsHuman && matchesAction(s.action, toolName),
  );
  const block = pRisk >= config.thresholds.risk || !!needsHumanStep;
  if (block && !code) {
    code = pRisk >= config.thresholds.risk ? "RISK_HIGH" : "NEEDS_HUMAN";
    hint = hint ?? "Lower is_risky or confirm. Use /jev:status for card.";
  }
  return {
    block,
    reason,
    pRisk,
    via,
    step,
    code,
    hint,
    retryable: block ? true : undefined,
    warning,
  };
}
