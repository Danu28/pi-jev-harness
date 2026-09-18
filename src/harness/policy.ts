/**
 * Policy Engine — pure Jev concepts, single batched classify per turn.
 * No model routing. One Jev call evaluates 4 questions in parallel (blog: barely changes latency).
 * Zero deps, rules fallback mirrors same Question shapes.
 */
import type { JevClient } from "../jev-client.ts";
import type { HarnessConfig, PolicyDecision } from "../types.ts";

export async function evaluatePolicy(
  client: JevClient,
  config: HarnessConfig,
  state: string,
): Promise<PolicyDecision> {
  const t0 = Date.now();
  const rulesFallback = (): PolicyDecision => {
    const len = state.length;
    // heavy Jev concepts that alone warrant a plan — catches audit/refactoring typo variants too
    const heavy = /(audit|refactor\w*|reorg|migrate\w*|architect\w*|security|cleanup|tidy\w*|inconsist|duplicat|cross.?cut|safer)/i.test(state);
    const kw = (state.match(/\b(and|then|after|audit|refactor\w*|reorg|migrate\w*|architect\w*|security|cleanup|tidy\w*|branch|workflow|inconsist|duplicat|safer)\b/gi) ?? []).length;
    const score = Math.min(1, len / 4000 + kw * 0.14 + (heavy ? 0.48 : 0));
    const level = score > 0.66 ? "high" : score > 0.33 ? "medium" : "low";
    const isUrgent = /\b(urgent|asap|p0|blocking|customers seeing|500s|failing)\b/i.test(state);
    const needsHuman = /\b(destructive|secrets|prod|deploy|payment)\b/i.test(state);
    return {
      complexity: { level, score, confidence: 0.55, via: "rules" },
      isUrgent: { p: isUrgent ? 0.85 : 0.15, confidence: 0.6, via: "rules" },
      needsPlan: { p: score >= config.thresholds.complexity ? 0.8 : 0.2, confidence: 0.55, via: "rules" },
      needsHuman: { p: needsHuman ? 0.8 : 0.15, confidence: 0.6, via: "rules" },
      latencyMs: 0,
    };
  };

  if (!client.isConfigured) return rulesFallback();
  try {
    const res = await client.classify({
      model: config.model,
      state: state.slice(0, 8000),
      questions: {
        complexity: { type: "score", instructions: "Rate task complexity low/medium/high for coding agent", levels: ["low", "medium", "high"] } as any,
        is_urgent: { type: "noul", instructions: "The message conveys urgency or time-sensitivity" } as any,
        needs_plan: { type: "noul", instructions: "This task needs a multi-step plan before execution" } as any,
        needs_human: { type: "noul", instructions: "This task needs human confirmation before acting (destructive, secrets, prod)" } as any,
      },
    });
    const sc = res.scores["complexity"];
    const urgent = res.nouls["is_urgent"];
    const plan = res.nouls["needs_plan"];
    const human = res.nouls["needs_human"];
    const score = sc?.score ?? 0.5;
    const level = score > 0.66 ? "high" : score > 0.33 ? "medium" : "low";
    return {
      complexity: { level, score, confidence: sc?.confidence ?? 0.5, via: "jev" },
      isUrgent: { p: urgent?.noul ?? 0.2, confidence: urgent?.confidence ?? 0.5, via: "jev" },
      needsPlan: { p: plan?.noul ?? (score > 0.5 ? 0.8 : 0.2), confidence: plan?.confidence ?? 0.5, via: "jev" },
      needsHuman: { p: human?.noul ?? 0.2, confidence: human?.confidence ?? 0.5, via: "jev" },
      latencyMs: res.latencyMs,
    };
  } catch {
    return { ...rulesFallback(), latencyMs: Date.now() - t0 };
  }
}
