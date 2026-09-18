/**
 * PI-MODEL Planner as TOOL — 2-Tool Chain (System-Two) companion to pi-classifier.
 * Enhanced: smart tool actions, cursor/done, family mapping, emoji fallback, batch nudge.
 */
import type { Via } from "../types.ts";

export const PLAN_ACTIONS = [
  "read",
  "bash",
  "edit",
  "write",
  "ask-human",
  "smart_read",
  "smart_bundle",
  "smart_edit",
  "fetch",
  "cext_batch",
] as const;
export type PlanAction = (typeof PLAN_ACTIONS)[number];

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
            enum: [...PLAN_ACTIONS],
            description: "Primary tool for step — prefer smart_bundle when touching ≤8 files",
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
  action: PlanAction;
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
  cursor: number; // index of next step to execute (0-based)
  done: string[]; // ids completed
}

// Tool family mapping for gate (smart_bundle covers read/edit/write families)
export const TOOL_FAMILY: Record<string, string[]> = {
  smart_bundle: ["read", "edit", "write", "bash"],
  smart_read: ["read"],
  smart_edit: ["edit"],
  smart_write: ["write"],
  cext_batch: ["read", "edit", "write", "bash"],
  fetch: ["read"],
};

export function matchesAction(planAction: string, toolName: string): boolean {
  if (planAction === toolName) return true;
  const fam = TOOL_FAMILY[planAction];
  if (fam?.includes(toolName)) return true;
  // reverse: if tool is family and plan is primitive, also match
  const rev = TOOL_FAMILY[toolName];
  if (rev?.includes(planAction)) return true;
  return false;
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
    cursor: 0,
    done: [],
  };
}

export function buildJevPlanInstruction(
  state: string,
  calibration: { complexity: { level: string; score: number }; needsPlan: { p: number } },
): string {
  return `[JEV plan required — call jev_plan tool now]\nSTATE: ${state.slice(0, 1400)}\nCALIBRATION: complexity=${calibration.complexity.level} score=${calibration.complexity.score.toFixed(2)} needs_plan=${calibration.needsPlan.p.toFixed(2)} via=pi-model\nDecompose into 2-7 sequential steps (id:s1.. title, action:read/bash/edit/write/ask-human/smart_read/smart_bundle/smart_edit/fetch/cext_batch, risk 0-1 Noul per step, needsHuman, dependsOn). Prefer smart_bundle when touching ≤8 files in same area (1 LLM call vs N). Order by execution. Last step should be git commit via jev_git (action=commit) with jev message. Call jev_plan with all fields + confidence. Do NOT run bash/write/edit before planning.`;
}

// ── UI formatting ──────────────────────────────────────────────────────────
export const ACTION_ICON: Record<string, string> = {
  read: "🔍",
  bash: "⚙️",
  edit: "✏️",
  write: "📝",
  "ask-human": "👤",
  smart_read: "🔍",
  smart_bundle: "📦",
  smart_edit: "✏️",
  fetch: "🌐",
  cext_batch: "🧩",
};
const ACTION_ASCII: Record<string, string> = {
  read: "[read]",
  bash: "[bash]",
  edit: "[edit]",
  write: "[write]",
  "ask-human": "[human]",
  smart_read: "[s-read]",
  smart_bundle: "[bundle]",
  smart_edit: "[s-edit]",
  fetch: "[fetch]",
  cext_batch: "[cext]",
};
function useEmoji(): boolean {
  if (process.env.PI_NO_EMOJI === "1" || process.env.NO_EMOJI === "1" || process.env.NO_COLOR === "1") return false;
  return true;
}
function riskBadge(risk: number): string {
  if (risk >= 0.85) return "🔴 high";
  if (risk >= 0.5) return "🟡 medium";
  if (risk >= 0.25) return "🟢 low";
  return "🟢 minimal";
}
function actionLabel(a: string): string {
  if (useEmoji()) return `${ACTION_ICON[a] ?? "•"} ${a}`;
  return `${ACTION_ASCII[a] ?? `[${a}]`} ${a}`;
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
  const cols = (process.stdout as unknown as { columns?: number })?.columns ?? 80;
  const divider = "─".repeat(Math.min(52, Math.max(24, cols - 28)));
  const lines = formatSteps(p.steps, true);
  const reasoning = p.reasoning ? `\n💡 ${p.reasoning}` : "";
  return `${header}\n${divider}\n${lines}${reasoning}`;
}

export function formatPlanNotify(decision: PlanDecision): string {
  const header = `📋 Jev Plan  ·  ${decision.steps.length} steps  ·  max risk ${decision.maxRisk.toFixed(2)} ${riskBadge(decision.maxRisk)}`;
  const cols = (process.stdout as unknown as { columns?: number })?.columns ?? 80;
  const divider = "─".repeat(Math.min(44, Math.max(20, cols - 32)));
  const lines = formatSteps(decision.steps, false);
  const reasoning = decision.reasoning ? `\n💡 ${decision.reasoning}` : "";
  return `${header}\n${divider}\n${lines}${reasoning}`;
}

export function formatNextStep(decision: PlanDecision): string {
  const idx = decision.cursor ?? 0;
  if (idx >= decision.steps.length)
    return `✅ Jev plan complete — ${decision.steps.length}/${decision.steps.length} done. Next: jev_git commit`;
  const s = decision.steps[idx];
  const deps = s.dependsOn?.length ? ` depends on ${s.dependsOn.join(",")}` : "";
  const done = decision.done.length
    ? ` (${decision.done.length}/${decision.steps.length} done)`
    : "";
  return `➡️ Next: ${actionLabel(s.action)} ${s.id} — ${s.title}  risk ${s.risk.toFixed(2)}${s.needsHuman ? " needsHuman" : ""}${deps}${done}\n   Run: ${s.action}  ·  /jev:next for details  ·  /jev:status for card`;
}
