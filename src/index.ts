/**
 * pi-jev-harness — PI-MODEL-POWERED Jev harness (NOT regular extension).
 * Uses the user's active pi model (PI_PROVIDER/PI_MODEL) to evaluate Jev Questions
 * (Score/Noul) in parallel — via:"pi-model" when available, via:"rules" only as
 * fallback that still keeps Jev concepts (typed probs + thresholds). Zero external
 * Typesafe key required, zero regular regex-only blocking.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stateFromPrompt } from "./jev-client.ts";
import { resolveConfig } from "./harness/config.ts";
import { JevCache } from "./harness/cache.ts";
import { evaluatePolicyWithPiModel, assessRiskWithPiModel } from "./harness/pi-classifier.ts";

export default function (pi: ExtensionAPI) {
  const config = resolveConfig(process.env as any);
  const cache = new JevCache(config.cacheTtlMs);
  let lastPolicy: any = null;
  let lastRisk: any = null;

  pi.on("session_start", async (_e, ctx) => {
    const provider = process.env.PI_PROVIDER ?? "local";
    const model = process.env.PI_MODEL ?? config.model;
    const viaHint = lastPolicy?.complexity?.via ?? "pi-model/rules";
    ctx.ui.setStatus("jev", ctx.ui.theme.fg("success", `jev:pi-model ${provider}/${model}`));
    // Not regular: status shows pi model powering Jev, not regex
  });

  // Harness Loop — before_agent_start: ONE pi-model batch 4 Qs parallel (Jev System-One)
  pi.on("before_agent_start", async (event: any) => {
    const prompt: string = event.prompt ?? event.message?.content ?? "";
    if (!prompt || String(prompt).startsWith("[JEV")) return;
    const state = stateFromPrompt(String(prompt));
    const key = `policy:${state.slice(0, 2000)}`;
    let policy = cache.get<any>(key);
    if (!policy) {
      policy = await evaluatePolicyWithPiModel(config, state); // ← uses PI_MODEL
      cache.set(key, policy);
    }
    lastPolicy = policy;
    pi.appendEntry("jev", { type: "policy", policy, provider: process.env.PI_PROVIDER, model: process.env.PI_MODEL, at: Date.now() });

    const hints: string[] = [];
    if (policy.complexity.level !== "low" && policy.needsPlan.p >= 0.5) {
      hints.push(`complexity=${policy.complexity.level} (${policy.complexity.score.toFixed(2)} via=${policy.complexity.via}) — create numbered plan before edits`);
    }
    if (policy.isUrgent.p >= config.thresholds.urgent) hints.push(`urgent p=${policy.isUrgent.p.toFixed(2)} via=${policy.isUrgent.via}`);
    if (policy.needsHuman.p >= 0.6) hints.push(`needs-human p=${policy.needsHuman.p.toFixed(2)} — ask before prod/secrets`);
    if (hints.length === 0) return;
    return {
      message: {
        customType: "jev-policy",
        content: `[JEV pi-model via=${policy.complexity.via} latency=${policy.latencyMs}ms provider=${process.env.PI_PROVIDER}/${process.env.PI_MODEL}] ${hints.join("; ")}`,
        display: false,
      },
    };
  });

  // Risk gate — before every tool, Noul via pi-model (not regular regex)
  pi.on("tool_call", async (event: any, ctx: any) => {
    const toolName = event.toolName as string;
    const input = event.input as Record<string, unknown>;
    const decision = await assessRiskWithPiModel(config, toolName, input); // ← pi-model Noul
    lastRisk = { toolName, input, decision, via: decision.via };
    pi.appendEntry("jev", { type: "risk", toolName, decision, provider: process.env.PI_PROVIDER, at: Date.now() });

    ctx.ui.setWidget("jev", [
      `policy:${lastPolicy?.complexity.level ?? "-"} via=${lastPolicy?.complexity.via ?? "-"}`,
      `risk:${decision.pRisk.toFixed(2)} via=${decision.via}`,
    ]);

    if (decision.block) {
      if (!ctx.hasUI) return { block: true, reason: decision.reason ?? `Jev pi-model gate (p=${decision.pRisk.toFixed(2)})` };
      const ok = await ctx.ui.confirm("Jev pi-model Gate", `${decision.reason}\n\nTool: ${toolName}\nInput: ${JSON.stringify(input).slice(0, 500)}\n\nAllow? (via:${decision.via} provider:${process.env.PI_PROVIDER})`);
      if (!ok) return { block: true, reason: `Blocked by pi-model Jev gate pRisk=${decision.pRisk.toFixed(2)}` };
    }
    if (decision.pRisk >= 0.5 && lastPolicy?.isUrgent.p >= 0.85) {
      pi.appendEntry("jev", { type: "warn", msg: "urgent+risk combo", at: Date.now() });
    }
    return undefined;
  });

  pi.registerCommand("jev:status", {
    description: "Show last pi-model Jev policy + risk (NOT regular regex)",
    handler: async (_args: string, ctx: any) => {
      ctx.ui.notify(
        `Jev harness — pi-model powered (NOT regular)\n  provider: ${process.env.PI_PROVIDER}/${process.env.PI_MODEL}\n  policy: ${JSON.stringify(lastPolicy, null, 2)}\n  risk: ${JSON.stringify(lastRisk, null, 2)}`,
        "info",
      );
    },
  });
  pi.registerCommand("jev:audit", { description: "Audit last tool risk (pi-model Jev)", handler: async (_a: string, ctx: any) => { if (!lastRisk) { ctx.ui.notify("No tool calls yet", "warning"); return; } ctx.ui.notify(JSON.stringify(lastRisk, null, 2), "info"); } });
  pi.registerCommand("jev:clear", { description: "Clear pi-model cache", handler: async (_a: string, ctx: any) => { cache.clear(); ctx.ui.notify("Jev pi-model cache cleared", "info"); } });
}
