/**
 * Complexity Scorer — Jev Score + Noul: decides if think/plan needed and how detailed.
 * Used in before_agent_start to inject plan hint or skip.
 */
import type { JevClient } from "../jev-client.ts";
import type { HarnessConfig } from "../types.ts";

export interface ComplexityDecision { level: "low" | "medium" | "high"; score: number; confidence: number; needsPlan: boolean; latencyMs: number; via: "jev" | "rules"; }

export async function scoreComplexity(client: JevClient, config: HarnessConfig, state: string): Promise<ComplexityDecision> {
  const ruleScore = (): ComplexityDecision => {
    const s = Math.min(1, state.length / 6000 + (/\b(and|then|after|refactor|migrate|architect)\b/gi.exec(state)?.length ?? 0) * 0.12);
    const level = s > 0.66 ? "high" : s > 0.33 ? "medium" : "low";
    return { level, score: s, confidence: 0.55, needsPlan: s >= config.thresholds.complexity, latencyMs: 0, via: "rules" };
  };
  if (!client.isConfigured) return ruleScore();
  try {
    const res = await client.classify({
      model: config.model,
      state,
      questions: {
        complexity: { type: "score", instructions: "Rate task complexity for coding agent", levels: ["low", "medium", "high"] } as any,
        needs_plan: { type: "noul", instructions: "This task needs a multi-step plan before execution" } as any,
      },
    });
    const sc = res.scores["complexity"];
    const np = res.nouls["needs_plan"];
    const score = sc?.score ?? 0.5;
    const level = score > 0.66 ? "high" : score > 0.33 ? "medium" : "low";
    return { level, score, confidence: sc?.confidence ?? 0.5, needsPlan: (np?.noul ?? (score > 0.5 ? 0.8 : 0.2)) >= 0.5, latencyMs: res.latencyMs, via: "jev" };
  } catch {
    return ruleScore();
  }
}
