/**
 * PI-MODEL Planner as TOOL — 2-Tool Chain (System-Two) companion to pi-classifier.
 * jev_calibrate (System-One) decides IF plan needed; jev_plan decomposes WHAT.
 * Zero deps, via:pi-model, audited. Only invoked when needs_plan >= 0.5.
 */
import type { Via } from "../types.ts";

export const jevPlanSchema = {
  type: "object",
  properties: {
    state: { type: "string", description: "STATE being planned" },
    complexity_level: {
      type: "string",
      enum: ["low", "medium", "high"],
      description: "Inherit from calibration",
    },
    steps: {
      type: "array",
      minItems: 2,
      maxItems: 7,
      description: "2-7 sequential steps, ordered by execution",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "s1,s2..." },
          title: { type: "string", description: "Short step goal" },
          action: {
            type: "string",
            enum: ["read", "bash", "edit", "write", "ask-human"],
            description: "Primary tool for step",
          },
          risk: { type: "number", minimum: 0, maximum: 1, description: "Per-step is_risky Noul" },
          needsHuman: { type: "boolean", description: "Step needs human confirmation" },
          dependsOn: {
            type: "array",
            items: { type: "string" },
            description: "IDs this step depends on",
          },
        },
        required: ["id", "title", "action", "risk"],
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reasoning: { type: "string", description: "One sentence why this decomposition" },
  },
  required: ["state", "complexity_level", "steps", "confidence"],
} as const;

export type JevPlanStep = {
  id: string;
  title: string;
  action: "read" | "bash" | "edit" | "write" | "ask-human";
  risk: number;
  needsHuman?: boolean;
  dependsOn?: string[];
};

export type JevPlanParams = {
  state: string;
  complexity_level: "low" | "medium" | "high";
  steps: JevPlanStep[];
  confidence: number;
  reasoning?: string;
};

export interface PlanDecision {
  state: string;
  complexityLevel: "low" | "medium" | "high";
  steps: JevPlanStep[];
  confidence: number;
  reasoning?: string;
  via: Via;
  latencyMs: number;
  maxRisk: number;
}

export function planToDecision(p: JevPlanParams, latencyMs: number): PlanDecision {
  const maxRisk = Math.max(0, ...p.steps.map((s) => s.risk));
  return {
    state: p.state,
    complexityLevel: p.complexity_level,
    steps: p.steps,
    confidence: p.confidence,
    reasoning: p.reasoning,
    via: "pi-model" as Via,
    latencyMs,
    maxRisk,
  };
}

export function buildJevPlanInstruction(
  state: string,
  calibration: { complexity: { level: string; score: number }; needsPlan: { p: number } },
): string {
  return `[JEV plan required — call jev_plan tool now]\nSTATE: ${state.slice(0, 4000)}\nCALIBRATION: complexity=${calibration.complexity.level} score=${calibration.complexity.score.toFixed(2)} needs_plan=${calibration.needsPlan.p.toFixed(2)} via=pi-model\nDecompose into 2-7 sequential steps (id:s1.. title, action:read/bash/edit/write/ask-human, risk 0-1 Noul per step, needsHuman, dependsOn). Order by execution. Last step should be git commit via jev_git (action=commit) with jev message. Call jev_plan with all fields + confidence. Do NOT run bash/write/edit before planning.`;
}

// ── UI formatting ──────────────────────────────────────────────────────────
const ACTION_ICON: Record<string, string> = {
  read: "🔍",
  bash: "⚙️",
  edit: "✏️",
  write: "📝",
  "ask-human": "👤",
};
function riskBadge(risk: number): string {
  if (risk >= 0.85) return "🔴 high";
  if (risk >= 0.5) return "🟡 medium";
  if (risk >= 0.25) return "🟢 low";
  return "🟢 minimal";
}
function actionLabel(a: string): string {
  return `${ACTION_ICON[a] ?? "•"} ${a}`;
}
function formatSteps(steps: JevPlanStep[], withDeps: boolean): string {
  return steps
    .map((s, i) => {
      const n = String(i + 1).padStart(2, " ");
      const deps =
        withDeps && s.dependsOn?.length ? `  ↳ depends on ${s.dependsOn.join(", ")}` : "";
      const human = s.needsHuman ? "  👤 needs human" : "";
      return `${n}. ${actionLabel(s.action)}  ${s.id} — ${s.title}\n     risk ${s.risk.toFixed(2)} ${riskBadge(s.risk)}${human}${deps}`;
    })
    .join("\n");
}

export function formatPlanDisplay(p: JevPlanParams, decision: PlanDecision): string {
  const header = `📋 Jev Plan  ·  via pi-model  ·  ${p.steps.length} steps  ·  max risk ${decision.maxRisk.toFixed(2)} ${riskBadge(decision.maxRisk)}  ·  confidence ${(p.confidence * 100).toFixed(0)}%`;
  const divider = "─".repeat(52);
  const lines = formatSteps(p.steps, true);
  const reasoning = p.reasoning ? `\n💡 ${p.reasoning}` : "";
  return `${header}\n${divider}\n${lines}${reasoning}`;
}

export function formatPlanNotify(decision: PlanDecision): string {
  const header = `📋 Jev Plan  ·  ${decision.steps.length} steps  ·  max risk ${decision.maxRisk.toFixed(2)} ${riskBadge(decision.maxRisk)}`;
  const divider = "─".repeat(44);
  const lines = formatSteps(decision.steps, false);
  const reasoning = decision.reasoning ? `\n💡 ${decision.reasoning}` : "";
  return `${header}\n${divider}\n${lines}${reasoning}`;
}
