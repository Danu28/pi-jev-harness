/** UI helpers extracted from index.ts — pure functions over state (s3 split) */
import { phaseOf } from "../harness/gate.ts";
import { formatNextStep } from "../harness/pi-planner.ts";
import type { JevCache } from "../harness/cache.ts";
import type { HarnessConfig, PolicyDecision, RiskDecision, JevTelemetry } from "../types.ts";
import type { PlanDecision } from "../harness/pi-planner.ts";

export interface UiState {
  policy: PolicyDecision | null;
  risk: { decision: RiskDecision } | null;
  plan: PlanDecision | null;
  git: { hash?: string; action?: string } | null;
  pendingState: string | null;
  pendingPlanState: string | null;
  telemetry: JevTelemetry | null;
  trivialBypass: boolean;
  turnId: number;
  cache: JevCache;
  config: HarnessConfig;
}

export function nextActionHint(s: UiState): string {
  const ph = phaseOf({
    policy: s.policy,
    risk: s.risk,
    plan: s.plan,
    pendingState: s.pendingState,
    pendingPlanState: s.pendingPlanState,
  });
  if (ph === "awaitingCalibrate") return "call jev_calibrate";
  if (ph === "awaitingPlan") return "call jev_plan (separate, once per task)";
  if (s.plan && s.plan.cursor < s.plan.steps.length) {
    const nxt = s.plan.steps[s.plan.cursor];
    return `run ${nxt.action} for ${nxt.id}: ${nxt.title}`;
  }
  if (s.plan && s.plan.cursor >= s.plan.steps.length) return "call jev_git commit";
  return "proceed with tool";
}

export function actionableWidgetLines(
  s: UiState,
  gate: { pRisk: number; via: string; warning?: string },
): string[] {
  const ph = phaseOf({
    policy: s.policy,
    risk: s.risk,
    plan: s.plan,
    pendingState: s.pendingState,
    pendingPlanState: s.pendingPlanState,
  });
  if (!s.policy) {
    if (s.trivialBypass)
      return [`jev: trivial bypass • no calibrate (phase:${ph})`, `next: ${nextActionHint(s)}`];
    return [`jev: awaiting jev_calibrate · phase:${ph}`, `next: ${nextActionHint(s)}`];
  }
  const risk = gate.pRisk.toFixed(2);
  const base = `jev: ${s.policy.complexity.level} · risk ${risk} · ${ph}`;
  if (s.plan) {
    const cur = s.plan.cursor ?? 0;
    const total = s.plan.steps.length;
    const nxt = cur < total ? `${s.plan.steps[cur].id} ${s.plan.steps[cur].action}` : "done";
    return [base, `plan:${cur}/${total} next:${nxt}`];
  }
  return [base];
}

export function cardStatus(s: UiState): string {
  const noEmoji =
    process.env.PI_NO_EMOJI === "1" || process.env.NO_EMOJI === "1" || process.env.NO_COLOR === "1";
  const hdr = noEmoji ? "[jev] pi-model (tool, no fallback)" : "JeV pi-model (tool, no fallback)";
  const prov = `${process.env.PI_PROVIDER ?? "pi"}/${process.env.PI_MODEL ?? s.config.model}`;
  const ph = phaseOf({
    policy: s.policy,
    risk: s.risk,
    plan: s.plan,
    pendingState: s.pendingState,
    pendingPlanState: s.pendingPlanState,
  });
  const lines: string[] = [];
  lines.push(`${hdr}`);
  lines.push(`  provider: ${prov}  ·  phase: ${ph}  ·  turn: ${s.turnId}`);
  if (!s.policy) {
    lines.push(
      `  policy: (none)${s.trivialBypass ? " — trivial bypass active (no calibrate needed)" : ` — awaiting jev_calibrate (phase: ${ph})`}`,
    );
  } else {
    const c = s.policy.complexity;
    const badge =
      c.level === "high"
        ? noEmoji
          ? "[high]"
          : "🔴 high"
        : c.level === "medium"
          ? noEmoji
            ? "[med]"
            : "🟡 medium"
          : noEmoji
            ? "[low]"
            : "🟢 low";
    lines.push(
      `  policy: ${badge} score ${c.score.toFixed(2)} · urgent ${s.policy.isUrgent.p.toFixed(2)} · needsPlan ${s.policy.needsPlan.p.toFixed(2)} · risk ${s.risk?.decision.pRisk.toFixed(2) ?? "-"} via ${s.risk?.decision.via ?? "pi-model"} · conf ${(c.confidence * 100).toFixed(0)}%`,
    );
  }
  if (s.plan) {
    const cur = s.plan.cursor ?? 0;
    const tot = s.plan.steps.length;
    const rawBar = "▓".repeat(Math.min(cur, tot)) + "░".repeat(Math.max(0, tot - cur));
    const bar = noEmoji ? `[${cur}/${tot}]` : rawBar;
    lines.push(`  plan: ${cur}/${tot} ${bar}  maxRisk ${s.plan.maxRisk.toFixed(2)} via ${s.plan.via}`);
    lines.push(`  next: ${formatNextStep(s.plan).split("\n")[0]}`);
    if (s.plan.reasoning) lines.push(`  why: ${s.plan.reasoning}`);
  } else if (s.policy && s.policy.needsPlan.p >= 0.5 && s.policy.complexity.level !== "low") {
    lines.push(`  plan: pending — call jev_plan (separate, once per task)`);
  } else {
    lines.push(`  plan: —`);
  }
  if (s.git?.hash)
    lines.push(`  git: ${s.git.hash.slice(0, 7)} · ${s.git.action ?? "commit"}  (undo: /jev:git revert ${s.git.hash.slice(0, 7)})`);
  else lines.push(`  git: —  (no commits yet)`);
  if (s.telemetry) {
    const hr = s.cache.getStats().hitRate;
    const st = s.cache.getStats();
    lines.push(
      `  cost: ${s.telemetry.compressedChars}ch · ${s.telemetry.latencyMs}ms · cached=${s.telemetry.cached} · hitRate ${(hr * 100).toFixed(0)}% · cache ${st.size} entries`,
    );
  } else {
    const st = s.cache.getStats();
    lines.push(`  cost: —  (cache ${st.size} entries · hitRate ${(st.hitRate * 100).toFixed(0)}%)`);
  }
  lines.push(`  nextAction: ${nextActionHint(s)}`);
  lines.push(`  thresholds: risk ${s.config.thresholds.risk} · urgent ${s.config.thresholds.urgent}  (/jev:config to tune)`);
  lines.push(`  tips: /jev:next /jev:plan /jev:cost /jev:help · /jev:resume · /jev:git · /jev:clear`);
  if (s.trivialBypass) lines.push(`  note: trivial prompt — calibration bypassed (token saved ~450)`);
  return lines.join("\n");
}
