/**
 * pi-jev-harness — PI-MODEL Calibrated, TOOL-BASED, NO FALLBACK (NOT regular).
 * Flow: user prompt -> build Jev instruction -> pi model *calls* jev_calibrate tool
 * in same session with 5 parallel Questions (Score/Noul) -> via:pi-model.
 * No fetch, no PI_API_BASE, no auth.json, no Typesafe, no regex fallback.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stateFromPrompt } from "./jev-client.ts";
import { resolveConfig } from "./harness/config.ts";
import { JevCache } from "./harness/cache.ts";
import { jevCalibrateSchema, calibrateToPolicy, calibrateToRisk, buildJevInstruction, type JevCalibrateParams } from "./harness/pi-classifier.ts";

export default function (pi: ExtensionAPI) {
  const config = resolveConfig(process.env as any);
  const cache = new JevCache(config.cacheTtlMs);
  let lastPolicy: any = null;
  let lastRisk: any = null;
  let pendingState: string | null = null;
  let t0 = 0;

  // Calibration TOOL — pi model calls this with Jev Questions (5 parallel, Jev System-One)
  pi.registerTool({
    name: "jev_calibrate",
    label: "Jev Calibrate",
    description: "System-One Jev calibration: evaluate 5 parallel Questions (complexity Score + is_urgent/needs_plan/needs_human/is_risky Noul) for STATE. Call this BEFORE any other tool.",
    parameters: jevCalibrateSchema as any,
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const p = params as JevCalibrateParams;
      const latencyMs = Date.now() - t0;
      const policy = calibrateToPolicy(p, latencyMs);
      const risk = calibrateToRisk(p, config);
      lastPolicy = policy;
      lastRisk = { toolName: "jev_calibrate", input: p, decision: risk, via: "pi-model", state: p.state };
      const key = `policy:${p.state.slice(0, 2000)}`;
      cache.set(key, policy);
      (pi as any).appendEntry?.("jev", { type: "policy", policy, calibration: p, at: Date.now(), provider: process.env.PI_PROVIDER, model: process.env.PI_MODEL });
      return {
        content: [{ type: "text", text: `calibrated via:pi-model complexity=${policy.complexity.level} score=${policy.complexity.score.toFixed(2)} urgent=${policy.isUrgent.p.toFixed(2)} needsPlan=${policy.needsPlan.p.toFixed(2)} risk=${risk.pRisk.toFixed(2)}` }],
        details: { policy, risk },
      };
    },
  });

  pi.on("session_start", async (_e, ctx) => {
    ctx.ui.setStatus("jev", ctx.ui.theme.fg("success", `jev:pi-model ${process.env.PI_PROVIDER ?? "pi"}/${process.env.PI_MODEL ?? config.model}`));
  });

  // BEFORE agent: inject Jev instruction so pi model knows to call jev_calibrate
  pi.on("before_agent_start", async (event: any) => {
    const prompt: string = event.prompt ?? event.message?.content ?? "";
    if (!prompt || String(prompt).startsWith("[JEV")) return;
    const state = stateFromPrompt(String(prompt));
    // If cached, reuse without asking model again
    const key = `policy:${state.slice(0, 2000)}`;
    const cached = cache.get<any>(key);
    if (cached) {
      lastPolicy = cached;
      const hints: string[] = [];
      if (cached.complexity.level !== "low" && cached.needsPlan.p >= 0.5) hints.push(`complexity=${cached.complexity.level} via=pi-model — plan recommended`);
      if (cached.isUrgent.p >= config.thresholds.urgent) hints.push(`urgent p=${cached.isUrgent.p.toFixed(2)}`);
      if (hints.length) return { message: { customType: "jev-policy", content: `[JEV pi-model cached] ${hints.join("; ")}`, display: false } };
      return;
    }
    pendingState = state;
    t0 = Date.now();
    return {
      message: {
        customType: "jev-policy",
        // This message forces the pi model to call jev_calibrate tool next
        content: buildJevInstruction(state),
        display: false,
      },
    };
  });

  // Risk gate — runs on every tool AFTER calibration; uses last calibration's is_risky
  pi.on("tool_call", async (event: any, ctx: any) => {
    const toolName = event.toolName as string;
    if (toolName === "jev_calibrate") return undefined; // allow calibration always
    const input = event.input as Record<string, unknown>;
    // No fallback: if not calibrated yet, block and ask for calibration first
    if (!lastPolicy) {
      if (pendingState) {
        // Still waiting for calibration — block until jev_calibrate called
        return { block: true, reason: "Jev calibration pending — pi model must call jev_calibrate first (Score/Noul via pi-model). This is NOT regular regex — it's pi-model System-One." };
      }
      return { block: true, reason: "No Jev calibration — cannot evaluate risk without pi-model via:pi-model" };
    }
    // Use last calibration's is_risky if state matches, else require fresh calibration is not needed —
    // For per-tool risk, the jev_calibrate already included is_risky for this state if model calibrated.
    // We treat lastRisk's is_risky as current risk; for new tool we ask model to recalibrate via same tool.
    // Simplest: show lastRisk, but block if its pRisk high and tool is risky.
    const decision = lastRisk?.decision;
    if (decision && (toolName === "bash" || toolName === "write" || toolName === "edit")) {
      if (decision.block) {
        if (!ctx.hasUI) return { block: true, reason: decision.reason };
        const ok = await ctx.ui.confirm("Jev pi-model Gate", `${decision.reason}\n\nTool: ${toolName}\nInput: ${JSON.stringify(input).slice(0, 500)}\nVia: pi-model — recalibrate if wrong.`);
        if (!ok) return { block: true, reason: `Blocked by pi-model Jev gate pRisk=${decision.pRisk.toFixed(2)}` };
      }
    }
    ctx.ui.setWidget("jev", [
      `policy:${lastPolicy?.complexity.level ?? "-"} via=pi-model`,
      `risk:${lastRisk?.decision.pRisk.toFixed(2) ?? "-"} via=pi-model`,
    ]);
    return undefined;
  });

  pi.registerCommand("jev:status", {
    description: "Show last pi-model Jev calibration (tool-based, no fallback)",
    handler: async (_a: string, ctx: any) => {
      ctx.ui.notify(`Jev pi-model (tool, no fallback)\n  provider: ${process.env.PI_PROVIDER}/${process.env.PI_MODEL}\n  policy: ${JSON.stringify(lastPolicy, null, 2)}\n  risk: ${JSON.stringify(lastRisk, null, 2)}`, "info");
    },
  });
  pi.registerCommand("jev:clear", { description: "Clear calibration cache", handler: async (_a: string, ctx: any) => { cache.clear(); lastPolicy = null; lastRisk = null; ctx.ui.notify("Jev cache cleared — next turn will recalibrate via pi-model", "info"); } });
}
