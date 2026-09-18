/**
 * PI-MODEL Calibrator as TOOL — no fallback, no fetch, no Typesafe.
 * Enhanced: compression, tiered instruction, merged plan option, batch nudge.
 */
import type { HarnessConfig, PolicyDecision, Via } from "../types.ts";
import { compressState, shouldUseShortInstruction } from "../jev-client.ts";
import type { JevPlanParams } from "./pi-planner.ts";

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
    plan: {
      type: "object",
      description: "Optional: if needs_plan>=0.5 include 2-7 steps now to save 1 LLM turn (merged calibrate+plan)",
      properties: {
        steps: {
          type: "array", minItems: 2, maxItems: 7,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              action: { type: "string", enum: ["read","bash","edit","write","ask-human","smart_read","smart_bundle","smart_edit","fetch","cext_batch"] },
              risk: { type: "number", minimum: 0, maximum: 1 },
              needsHuman: { type: "boolean" },
              dependsOn: { type: "array", items: { type: "string" } },
            },
            required: ["id","title","action","risk"],
          }
        },
        reasoning: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    },
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
  plan?: { steps: JevPlanParams["steps"]; reasoning?: string; confidence?: number };
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

export function buildJevInstruction(state: string, opts?: { short?: boolean; compressedChars?: number }): string {
  const compressed = compressState(state, opts?.compressedChars ?? 1200);
  if (opts?.short || shouldUseShortInstruction(compressed, false)) {
    return `[JEV calibration required — call jev_calibrate tool now] STATE: ${compressed.slice(0, 1200)} Evaluate 5 parallel Questions: complexity_score+level (low/med/high), is_urgent, needs_plan, needs_human, is_risky 0-1 + confidence. Call jev_calibrate (8 fields). Tip: if needs_plan≥0.5 include plan.steps in SAME call to save 1 turn.`;
  }
  return `[JEV calibration required — call jev_calibrate tool now]\nSTATE: ${compressed.slice(0, 1400)}\nEvaluate 5 parallel Questions (Jev System-One):\n- complexity_score + complexity_level (Score low/med/high)\n- is_urgent Noul 0-1\n- needs_plan Noul 0-1\n- needs_human Noul 0-1\n- is_risky Noul 0-1 (if STATE is a tool call)\nCall jev_calibrate with all 8 fields + confidence (0-1). Tip: if needs_plan≥0.5 and decomposition is obvious, include plan:{steps,reasoning} in SAME call (merged calibrate+plan, saves 1 LLM turn). Do NOT act before calibrating. Prefer smart_bundle over serial read→edit when touching ≤8 files.`;
}

export function buildShortCalibrateInstruction(state: string): string {
  return buildJevInstruction(state, { short: true });
}
