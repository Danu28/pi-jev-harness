/**
 * Model Router — Jev Choice: fast vs powerful
 * pi.on("before_agent_start") + pi.setModel() decides per-turn model.
 * Falls back to rule heuristics (length/complexity keywords) when no API key.
 */
import type { JevClient } from "../jev-client.ts";
import type { HarnessConfig } from "../types.ts";

export interface RouteDecision { model: string; choice: string; confidence: number; probs: Record<string, number>; latencyMs: number; via: "jev" | "rules"; }

export async function routeModel(
  client: JevClient,
  config: HarnessConfig,
  state: string,
): Promise<RouteDecision> {
  // fallback rules — cheap, synchronous
  const rulesFallback = (): RouteDecision => {
    const complex = /(architect|refactor|migrate|security|race condition|perf.*critical|design doc)/i.test(state);
    const long = state.length > 4000;
    const choice = complex || long ? "powerful" : "fast";
    return { model: config.routing[choice as "fast"], choice, confidence: 0.6, probs: { [choice]: 0.6 }, latencyMs: 0, via: "rules" };
  };

  if (!client.isConfigured) return rulesFallback();
  try {
    const res = await client.classify({
      model: config.model,
      state,
      questions: {
        model_choice: {
          type: "choice",
          instructions: "Choose the least costly model that can complete the task.",
          choices: {
            fast: { criteria: "Direct lookups, extraction, localized changes, CRUD" },
            powerful: { criteria: "Architecture, high-stakes decisions, multi-file reasoning, security" },
          },
        } as any,
      },
    });
    const c = res.choices["model_choice"];
    if (!c) return rulesFallback();
    const model = c.choice === "powerful" ? config.routing.powerful : config.routing.fast;
    return { model, choice: c.choice, confidence: c.confidence, probs: c.probs, latencyMs: res.latencyMs, via: "jev" };
  } catch {
    return rulesFallback();
  }
}
