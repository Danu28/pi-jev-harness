/** Tool executors extracted from index.ts — factories over state accessors (s3) */
import { calibrateToPolicy, calibrateToRisk, jevCalibrateSchema, buildJevInstruction } from "../harness/pi-classifier.ts";
import { planToDecision, jevPlanSchema, formatPlanDisplay, formatNextStep, buildJevPlanInstruction } from "../harness/pi-planner.ts";
import { handleJevGit, jevGitSchema } from "../harness/pi-git.ts";
import { compressState } from "../jev-client.ts";
import type { JevCache } from "../harness/cache.ts";
import type { HarnessConfig, PolicyDecision, RiskDecision, JevTelemetry } from "../types.ts";
import type { PlanDecision, JevPlanParams } from "../harness/pi-planner.ts";
import type { JevCalibrateParams } from "../harness/pi-classifier.ts";
import type { JevGitParams } from "../harness/pi-git.ts";

export interface ToolDeps {
  pi: unknown;
  config: HarnessConfig;
  cache: JevCache;
  get: () => {
    policy: PolicyDecision | null;
    risk: { decision: RiskDecision } | null;
    plan: PlanDecision | null;
    git: { hash?: string; action?: string } | null;
    pendingState: string | null;
    pendingPlanState: string | null;
    t0: number;
    tPlan0: number;
    turnId: number;
    lastCalibrateTurn: number;
    lastPlanTurn: number;
    hadGitCommitThisTurn: boolean;
    telemetry: JevTelemetry | null;
    lastWasLowRisk: boolean;
  };
  set: (patch: Partial<{
    policy: PolicyDecision | null;
    risk: { decision: RiskDecision } | null;
    plan: PlanDecision | null;
    git: { hash?: string; action?: string } | null;
    pendingState: string | null;
    pendingPlanState: string | null;
    t0: number;
    tPlan0: number;
    lastCalibrateTurn: number;
    lastPlanTurn: number;
    hadGitCommitThisTurn: boolean;
    telemetry: JevTelemetry | null;
    lastWasLowRisk: boolean;
  }>) => void;
  append: (entry: unknown) => void;
  nextHint: () => string;
}

export function jevCalibrateExecute(deps: ToolDeps) {
  return async (_toolCallId: string, params: unknown) => {
    const p = params as JevCalibrateParams;
    const s = deps.get();
    if (s.lastCalibrateTurn === s.turnId && s.policy) {
      return {
        content: [{ type: "text", text: `blocked: jev_calibrate already called this task (turn ${s.turnId}) — proceed to jev_plan if needsPlan>=0.5, do not merge/re-call` }],
        details: { error: "already calibrated this task", code: "ALREADY_CALIBRATED", hint: "Calibration is once per task. Call jev_plan next if needed, do not re-call jev_calibrate.", retryable: false, nextAction: s.policy.needsPlan.p >= 0.5 ? "call jev_plan" : "proceed" },
      };
    }
    if ((p as unknown as { plan?: unknown }).plan) {
      return {
        content: [{ type: "text", text: "blocked: merged calibrate+plan not allowed — call jev_calibrate (8 fields only) then jev_plan separately (once per task)" }],
        details: { error: "merged not allowed", code: "MERGED_NOT_ALLOWED", hint: "Call jev_calibrate without plan, then call jev_plan separately.", retryable: true, nextAction: "call jev_calibrate without plan" },
      };
    }
    const latencyMs = Date.now() - s.t0;
    const policy = calibrateToPolicy(p, latencyMs);
    const risk = calibrateToRisk(p, deps.config);
    const needsPlan = policy.needsPlan.p >= 0.5 && policy.complexity.level !== "low";
    deps.set({
      policy,
      risk: { decision: risk },
      lastWasLowRisk: risk.pRisk < 0.4,
      lastCalibrateTurn: s.turnId,
      pendingPlanState: needsPlan ? p.state : null,
      tPlan0: needsPlan ? Date.now() : s.tPlan0,
      telemetry: { compressedChars: compressState(p.state).length, latencyMs, cached: false, trivialBypass: false },
    });
    deps.cache.set(`policy:${p.state.slice(0, 2000)}`, policy);
    deps.append({ type: "policy", policy, calibration: p, at: Date.now(), provider: process.env.PI_PROVIDER, model: process.env.PI_MODEL, telemetry: deps.get().telemetry });
    const base = `calibrated via:pi-model complexity=${policy.complexity.level} score=${policy.complexity.score.toFixed(2)} urgent=${policy.isUrgent.p.toFixed(2)} needsPlan=${policy.needsPlan.p.toFixed(2)} risk=${risk.pRisk.toFixed(2)}`;
    const suffix = needsPlan ? "\n[JEV plan required next — call jev_plan for this STATE now (separate, once per task)]" : "";
    const nextAct = needsPlan ? "call jev_plan" : "proceed";
    return {
      content: [{ type: "text", text: base + suffix }],
      details: { policy, risk, needsPlan: policy.needsPlan.p >= 0.5, plan: null, nextAction: nextAct, telemetry: deps.get().telemetry, hint: needsPlan ? "Call jev_plan next (separate call, once per task)" : `Next: ${nextAct}` },
    };
  };
}

export function jevPlanExecute(deps: ToolDeps) {
  return async (_toolCallId: string, params: unknown) => {
    const p = params as JevPlanParams;
    const s = deps.get();
    if (!s.policy)
      return {
        content: [{ type: "text", text: "blocked: must call jev_calibrate before jev_plan (separate calls, once per task)" }],
        details: { error: "calibrate first", code: "CALIBRATE_FIRST", hint: "Call jev_calibrate first (separate, once per task), then jev_plan", retryable: true, nextAction: "call jev_calibrate" },
      };
    if (s.lastPlanTurn === s.turnId && s.plan) {
      return {
        content: [{ type: "text", text: `blocked: jev_plan already called this task (turn ${s.turnId}) — once per task, proceed to execution` }],
        details: { error: "already planned this task", code: "ALREADY_PLANNED", hint: "Plan is once per task. Proceed with plan steps, do not re-call jev_plan.", retryable: false, nextAction: `run ${s.plan.steps[s.plan.cursor ?? 0]?.action ?? "read"}` },
      };
    }
    const latencyMs = Date.now() - (s.tPlan0 || s.t0);
    const decision = planToDecision(p, latencyMs);
    deps.set({ plan: decision, lastPlanTurn: s.turnId, pendingPlanState: null });
    deps.cache.set(`plan:${p.state.slice(0, 2000)}`, decision);
    deps.append({ type: "plan", plan: decision, params: p, at: Date.now(), provider: process.env.PI_PROVIDER, model: process.env.PI_MODEL });
    const pretty = formatPlanDisplay(p, decision);
    const next = formatNextStep(decision);
    return { content: [{ type: "text", text: pretty + "\n" + next }], details: { plan: decision, nextAction: `run ${decision.steps[0]?.action ?? "read"}`, cursor: 0, hint: next } };
  };
}

export function jevGitExecute(deps: ToolDeps) {
  return async (_toolCallId: string, params: unknown) => {
    const p = params as JevGitParams;
    const s = deps.get();
    const res = await handleJevGit(
      deps.pi as unknown as { exec?: (cmd: string, args: string[]) => Promise<{ code?: number; stdout?: string; stderr?: string }> },
      p,
      { policy: s.policy, plan: s.plan, state: s.pendingPlanState ?? s.pendingState },
    );
    if (p.action === "commit" && !res.details?.error && !(res.details as { clean?: boolean })?.clean) {
      const cur = deps.get();
      deps.set({ hadGitCommitThisTurn: true, git: res.details as { hash?: string } });
      if (cur.plan && cur.plan.cursor < cur.plan.steps.length) {
        const lastStep = cur.plan.steps[cur.plan.steps.length - 1];
        if (lastStep.action === "write" || (cur.plan.steps[0] as unknown)) {
          cur.plan.cursor = cur.plan.steps.length;
        }
      }
    }
    deps.append({ type: "git", action: p.action, params: p, result: res.details, at: Date.now() });
    return { content: [{ type: "text", text: res.text }], details: { ...res.details, nextAction: deps.nextHint() } };
  };
}

export const toolSchemas = { jevCalibrateSchema, jevPlanSchema, jevGitSchema };
