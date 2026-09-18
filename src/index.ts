/**
 * pi-jev-harness — Independent pi extension entry.
 * No pi-brain dependency. Hooks: before_agent_start (routing + complexity), tool_call (risk gate).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { JevClient, stateFromPrompt, stateFromToolCall } from "./jev-client.ts";
import { resolveConfig } from "./harness/config.ts";
import { JevCache } from "./harness/cache.ts";
import { routeModel } from "./middleware/model-router.ts";
import { assessRisk } from "./middleware/auto-mode.ts";
import { scoreComplexity } from "./middleware/complexity.ts";

export default function (pi: ExtensionAPI) {
  const config = resolveConfig(process.env as any);
  const client = new JevClient(config);
  const cache = new JevCache(config.cacheTtlMs);
  let lastRoute: any = null;
  let lastRisk: any = null;
  let lastComplexity: any = null;

  pi.on("session_start", async (_e, ctx) => {
    const mode = client.isConfigured ? "jev" : "rules-fallback";
    ctx.ui.setStatus("jev", ctx.ui.theme.fg(client.isConfigured ? "success" : "warning", `jev:${mode}`));
  });

  // Model routing + complexity — before LLM call
  pi.on("before_agent_start", async (event: any) => {
    const prompt: string = event.prompt ?? event.message?.content ?? "";
    if (!prompt) return;
    const state = stateFromPrompt(String(prompt));
    const cacheKey = `route:${state.slice(0, 2000)}`;
    let decision = cache.get<any>(cacheKey);
    if (!decision) {
      decision = await routeModel(client, config, state);
      cache.set(cacheKey, decision);
    }
    lastRoute = decision;
    if (decision.confidence >= 0.6) {
      try { pi.setModel(decision.model as any); } catch {}
    }
    const complexity = await scoreComplexity(client, config, state);
    lastComplexity = complexity;
    pi.appendEntry("jev", { type: "route", decision, complexity, at: Date.now() });
    if (complexity.needsPlan) {
      return {
        message: {
          customType: "jev-complexity",
          content: `[JEV] complexity=${complexity.level} score=${complexity.score.toFixed(2)} via=${complexity.via}. Plan recommended (${complexity.level}). Create a numbered plan before edits.`,
          display: false,
        },
      };
    }
  });

  // Risk gate — before every tool execution
  pi.on("tool_call", async (event: any, ctx: any) => {
    const toolName = event.toolName as string;
    const input = event.input as Record<string, unknown>;
    const state = stateFromToolCall(toolName, input);
    const decision = await assessRisk(client, config, toolName, input);
    lastRisk = { toolName, input, decision };
    pi.appendEntry("jev", { type: "risk", toolName, decision, at: Date.now() });

    // status widget: show last latency
    ctx.ui.setWidget("jev", [
      `route:${lastRoute?.choice ?? "-"}(${lastRoute?.via ?? "-"})`,
      `risk:${decision.pRisk.toFixed(2)} via=${decision.via}`,
    ]);

    if (decision.block) {
      if (!ctx.hasUI) return { block: true, reason: decision.reason ?? `Jev risk gate blocked (p=${decision.pRisk.toFixed(2)})` };
      const ok = await ctx.ui.confirm("Jev Risk Gate", `${decision.reason}\n\nTool: ${toolName}\nInput: ${JSON.stringify(input).slice(0, 500)}\n\nAllow?`);
      if (!ok) return { block: true, reason: `Blocked by Jev gate (pRisk=${decision.pRisk.toFixed(2)})` };
    }
    return undefined;
  });

  pi.registerCommand("jev:status", {
    description: "Show last Jev classifications",
    handler: async (_args: string, ctx: any) => {
      ctx.ui.notify(
        `Jev status\n  configured: ${client.isConfigured}\n  route: ${JSON.stringify(lastRoute, null, 2)}\n  complexity: ${JSON.stringify(lastComplexity, null, 2)}\n  risk: ${JSON.stringify(lastRisk, null, 2)}`,
        "info",
      );
    },
  });

  pi.registerCommand("jev:audit", {
    description: "Audit last tool call risk",
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
