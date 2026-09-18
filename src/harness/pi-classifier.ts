/**
 * PI-MODEL Calibrator as TOOL — no fallback, no fetch, no Typesafe.
 * User prompt -> build Jev instruction -> pi model *calls* jev_calibrate tool
 * in same session with JSON {Score/Noul + confidence} -> via:pi-model.
 * Best: zero external deps, uses pi's own tool-calling (clean, native, audited).
 */
import type { HarnessConfig, PolicyDecision, Via } from "../types.ts";

export const jevCalibrateSchema = {
  type: "object",
  properties: {
    state: { type: "string", description: "STATE being evaluated" },
    complexity_score: { type: "number", minimum: 0, maximum: 1 },
    complexity_level: { type: "string", enum: ["low", "medium", "high"] },
    is_urgent: { type: "number", minimum: 0, maximum: 1 },
    needs_plan: { type: "number", minimum: 0, maximum: 1 },
    needs_human: { type: "number", minimum: 0, maximum: 1 },
    is_risky: { type: "number", minimum: 0, maximum: 1 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "state",
    "complexity_score",
    "complexity_level",
    "is_urgent",
    "needs_plan",
    "needs_human",
    "is_risky",
    "confidence",
  ],
} as const;

export type JevCalibrateParams = {
  state: string;
  complexity_score: number;
  complexity_level: "low" | "medium" | "high";
  is_urgent: number;
  needs_plan: number;
  needs_human: number;
  is_risky: number;
  confidence: number;
};

export function calibrateToPolicy(p: JevCalibrateParams, latencyMs: number): PolicyDecision {
  const via: Via = "pi-model";
  return {
    complexity: {
      level: p.complexity_level,
      score: p.complexity_score,
      confidence: p.confidence,
      via,
    },
    isUrgent: { p: p.is_urgent, confidence: p.confidence, via },
    needsPlan: { p: p.needs_plan, confidence: p.confidence, via },
    needsHuman: { p: p.needs_human, confidence: p.confidence, via },
    latencyMs,
  };
}

export function calibrateToRisk(
  p: JevCalibrateParams,
  config: HarnessConfig,
): { block: boolean; pRisk: number; confidence: number; via: Via; reason?: string } {
  const pRisk = p.is_risky;
  return {
    block: pRisk >= config.thresholds.risk,
    pRisk,
    confidence: p.confidence,
    via: "pi-model",
    reason:
      pRisk >= config.thresholds.risk
        ? `pi-model pRisk=${pRisk.toFixed(2)} >= ${config.thresholds.risk}`
        : undefined,
  };
}

export function buildJevInstruction(state: string): string {
  return `[JEV calibration required — call jev_calibrate tool now]\nSTATE: ${state.slice(0, 4000)}\nEvaluate 5 parallel Questions (Jev System-One):\n- complexity_score + complexity_level (Score low/med/high)\n- is_urgent Noul 0-1\n- needs_plan Noul 0-1\n- needs_human Noul 0-1\n- is_risky Noul 0-1 (if STATE is a tool call)\nCall jev_calibrate with all 8 fields + confidence (0-1). Do NOT act before calibrating.`;
}
