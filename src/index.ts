/**
 * pi-jev-harness — Pure Jev-concept complete harness for pi.
 * Zero deps (no pi-brain, no external tools). No auto model picking.
 * Jev System-One: single batched classify per turn + Noul risk gate.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { JevClient, stateFromPrompt, stateFromToolCall } from "./jev-client.ts";
import { resolveConfig } from "./harness/config.ts";
import { JevCache } from "./harness/cache.ts";
import { evaluatePolicy } from "./harness/policy.ts";
import { assessRisk } from "./middleware/auto-mode.ts";

export default function (pi: ExtensionAPI) {
  const config = resolveConfig(process.env as any);
  const client = new JevClient(config);
  const cache = new JevCache(config.cacheTtlMs);
  let lastPolicy: any = null;
  let lastRisk: any = null;

  pi.on("session_start", async (_e, ctx) => {
    const mode = client.isConfigured ? "jev" : "rules";
    ctx.ui.setStatus("jev", ctx.ui.theme.fg(client.isConfigured ? "success" : "warning", `jev:${mode}`));
  });

  // Harness Loop — before_agent_start: ONE Jev call with 4 parallel questions (blog: barely changes latency)
  pi.on("before_agent_start", async (event: any) => {
    const prompt: string = event.prompt ?? event.message?.content ?? "";
    if (!prompt || String(prompt).startsWith("[JEV")) return;
    const state = stateFromPrompt(String(prompt));
    const key = `policy:${state.slice(0, 2000)}`;
    let policy = cache.get<any>(key);
    if (!policy) {
      policy = await evaluatePolicy(client, config, state);
      cache.set(key, policy);
    }
    lastPolicy = policy;
    pi.appendEntry("jev", { type: "policy", policy, at: Date.now() });

    // Update widget every turn — live Jev vs rules visibility
    // (setWidget is safe outside ctx; use session_start ctx pattern but also no-op if no ctx)
    // Widget update with risk placeholder is done on tool_call; here we just log.

    const hints: string[] = [];
    if (policy.complexity.level !== "low" && policy.needsPlan.p >= 0.5) {
      hints.push(`complexity=${policy.complexity.level} (${policy.complexity.score.toFixed(2)} via=${policy.complexity.via}) — create numbered plan before edits`);
    }
    if (policy.isUrgent.p >= config.thresholds.urgent) {
      hints.push(`urgent p=${policy.isUrgent.p.toFixed(2)}`);
    }
    if (policy.needsHuman.p >= 0.6) {
      hints.push(`needs-human p=${policy.needsHuman.p.toFixed(2)} — ask before destructive/prod actions`);
    }
    if (hints.length === 0) return;
    return {
      message: {
        customType: "jev-policy",
        content: `[JEV policy via=${policy.complexity.via} latency=${policy.latencyMs}ms] ${hints.join("; ")}`,
        display: false,
      },
    };
  });

  // Risk gate — before every tool (Noul, calibrated). Pure Jev concept.
  pi.on("tool_call", async (event: any, ctx: any) => {
    const toolName = event.toolName as string;
    const input = event.input as Record<string, unknown>;
    const decision = await assessRisk(client, config, toolName, input);
    lastRisk = { toolName, input, decision, via: decision.via };
    pi.appendEntry("jev", { type: "risk", toolName, decision, at: Date.now() });

    ctx.ui.setWidget("jev", [
      `policy:${lastPolicy?.complexity.level ?? "-"} via=${lastPolicy?.complexity.via ?? "-"}`,
      `risk:${decision.pRisk.toFixed(2)} via=${decision.via}`,
    ]);

    if (decision.block) {
      if (!ctx.hasUI) return { block: true, reason: decision.reason ?? `Jev risk gate (p=${decision.pRisk.toFixed(2)})` };
      const ok = await ctx.ui.confirm("Jev Risk Gate", `${decision.reason}\n\nTool: ${toolName}\nInput: ${JSON.stringify(input).slice(0, 500)}\n\nAllow?`);
      if (!ok) return { block: true, reason: `Blocked by Jev gate pRisk=${decision.pRisk.toFixed(2)}` };
    }
    // Urgent + destructive combo: extra nudge (pure Jev concept, no external flags)
    if (decision.pRisk >= 0.5 && lastPolicy?.isUrgent.p >= 0.85) {
      pi.appendEntry("jev", { type: "warn", msg: "urgent+risk combo", at: Date.now() });
    }
    return undefined;
  });

  pi.registerCommand("jev:status", {
    description: "Show last Jev policy + risk (pure Jev concepts)",
    handler: async (_args: string, ctx: any) => {
      ctx.ui.notify(
        `Jev harness (pure, no model routing)\n  mode: ${client.isConfigured ? "jev" : "rules"} model=${config.model}\n  policy: ${JSON.stringify(lastPolicy, null, 2)}\n  risk: ${JSON.stringify(lastRisk, null, 2)}`,
        "info",
      );
    },
  });

  pi.registerCommand("jev:audit", {
    description: "Audit last tool risk",
    handler: async (_args: string, ctx: any) => {
      if (!lastRisk) { ctx.ui.notify("No tool calls yet", "warning"); return; }
      ctx.ui.notify(JSON.stringify(lastRisk, null, 2), "info");
    },
  });

  pi.registerCommand("jev:clear", {
    description: "Clear Jev cache",
    handler: async (_args: string, ctx: any) => {
      cache.clear();
      ctx.ui.notify("Jev cache cleared", "info");
    },
  });
}
