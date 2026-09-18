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
import { jevPlanSchema, planToDecision, buildJevPlanInstruction, formatPlanDisplay, formatPlanNotify, type JevPlanParams } from "./harness/pi-planner.ts";
import { jevGitSchema, handleJevGit, autoCommitIfDirty, type JevGitParams } from "./harness/pi-git.ts";

export default function (pi: ExtensionAPI) {
  const config = resolveConfig(process.env as any);
  const cache = new JevCache(config.cacheTtlMs);
  let lastPolicy: any = null;
  let lastRisk: any = null;
  let lastPlan: any = null;
  let lastGit: any = null;
  let pendingState: string | null = null;
  let pendingPlanState: string | null = null;
  let t0 = 0;
  let tPlan0 = 0;
  let hadGitCommitThisTurn = false;

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
      // 2-Tool Chain: if plan needed, nudge model to call jev_plan next in same session
      const needsPlan = policy.needsPlan.p >= 0.5 && policy.complexity.level !== "low";
      if (needsPlan) {
        pendingPlanState = p.state;
        tPlan0 = Date.now();
      }
      const base = `calibrated via:pi-model complexity=${policy.complexity.level} score=${policy.complexity.score.toFixed(2)} urgent=${policy.isUrgent.p.toFixed(2)} needsPlan=${policy.needsPlan.p.toFixed(2)} risk=${risk.pRisk.toFixed(2)}`;
      const suffix = needsPlan ? `\n[JEV plan required next — call jev_plan for this STATE now]` : "";
      return {
        content: [{ type: "text", text: base + suffix }],
        details: { policy, risk, needsPlan },
      };
    },
  });

  // Planner TOOL — System-Two companion, only after jev_calibrate when needs_plan >= 0.5
  pi.registerTool({
    name: "jev_plan",
    label: "Jev Plan",
    description: "System-Two Jev plan: decompose STATE into 2-7 sequential steps with per-step risk/needsHuman. Call AFTER jev_calibrate when needs_plan>=0.5.",
    parameters: jevPlanSchema as any,
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const p = params as JevPlanParams;
      if (!lastPolicy) return { content: [{ type: "text", text: "blocked: must call jev_calibrate before jev_plan" }], details: { error: "calibrate first" } };
      const latencyMs = Date.now() - (tPlan0 || t0);
      const decision = planToDecision(p, latencyMs);
      lastPlan = decision;
      pendingPlanState = null;
      const key = `plan:${p.state.slice(0, 2000)}`;
      cache.set(key, decision);
      (pi as any).appendEntry?.("jev", { type: "plan", plan: decision, params: p, at: Date.now(), provider: process.env.PI_PROVIDER, model: process.env.PI_MODEL });
      const pretty = formatPlanDisplay(p, decision);
      return {
        content: [{ type: "text", text: pretty }],
        details: { plan: decision },
      };
    },
  });

  // Git TOOL — agent-friendly Jev Git (status/diff/log/commit/revert/init), auto-generates conventional commits via pi-model
  pi.registerTool({
    name: "jev_git",
    label: "Jev Git",
    description: "Agent-friendly git for Jev harness — status/diff/log/commit/revert/init. Commit auto-generates conventional message from Jev calibration/plan if message omitted. Call commit at end of task for audit/revert. Also try agent_settled auto-commit.",
    parameters: jevGitSchema as any,
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const p = params as JevGitParams;
      const res = await handleJevGit(pi, p, { policy: lastPolicy, plan: lastPlan, state: pendingPlanState ?? pendingState });
      if (p.action === "commit" && !res.details?.error && !res.details?.clean) {
        hadGitCommitThisTurn = true;
        lastGit = res.details;
      }
      (pi as any).appendEntry?.("jev", { type: "git", action: p.action, params: p, result: res.details, at: Date.now() });
      return { content: [{ type: "text", text: res.text }], details: res.details };
    },
  });

  pi.on("session_start", async (_e, ctx) => {
    ctx.ui.setStatus("jev", ctx.ui.theme.fg("success", `jev:pi-model ${process.env.PI_PROVIDER ?? "pi"}/${process.env.PI_MODEL ?? config.model}`));
  });
  pi.on("agent_start", async () => { hadGitCommitThisTurn = false; });
  pi.on("agent_end", async (_e, ctx: any) => {
    // lightweight nudging via widget is done in tool_call; auto-commit lives in agent_settled
  });
  pi.on("agent_settled", async (_e, ctx: any) => {
    if (hadGitCommitThisTurn) return;
    try {
      const res = await autoCommitIfDirty(pi, { policy: lastPolicy, plan: lastPlan, state: pendingPlanState ?? pendingState });
      if (res.committed) {
        lastGit = { action: "commit", hash: res.hash, via: "git:auto" };
        hadGitCommitThisTurn = true;
        (pi as any).appendEntry?.("jev", { type: "git:auto", hash: res.hash, at: Date.now() });
        if (ctx?.ui) ctx.ui.notify(`🌿 Jev auto-commit ${res.hash?.slice(0, 7)} — ${res.text?.split("\n")[0]}`, "info");
      }
    } catch {}
  });
  pi.on("session_shutdown", async (_e, ctx: any) => {
    if (hadGitCommitThisTurn) return;
    try {
      const res = await autoCommitIfDirty(pi, { policy: lastPolicy, plan: lastPlan, state: pendingPlanState ?? pendingState });
      if (res.committed && ctx?.ui) ctx.ui.notify(`🌿 Jev shutdown auto-commit ${res.hash?.slice(0, 7)}`, "info");
    } catch {}
  });

  // BEFORE agent: inject Jev instruction so pi model knows to call jev_calibrate
  pi.on("before_agent_start", async (event: any) => {
    const prompt: string = event.prompt ?? event.message?.content ?? "";
    if (!prompt || String(prompt).startsWith("[JEV")) return;
    const state = stateFromPrompt(String(prompt));
    // If cached, reuse without asking model again
    const key = `policy:${state.slice(0, 2000)}`;
    const planKey = `plan:${state.slice(0, 2000)}`;
    const cached = cache.get<any>(key);
    if (cached) {
      lastPolicy = cached;
      const cachedPlan = cache.get<any>(planKey);
      if (cachedPlan) lastPlan = cachedPlan;
      const hints: string[] = [];
      if (cached.complexity.level !== "low" && cached.needsPlan.p >= 0.5) {
        if (cachedPlan) hints.push(`complexity=${cached.complexity.level} via=pi-model — plan cached ${cachedPlan.steps.length} steps`);
        else hints.push(`complexity=${cached.complexity.level} via=pi-model — plan recommended`);
      }
      if (cached.isUrgent.p >= config.thresholds.urgent) hints.push(`urgent p=${cached.isUrgent.p.toFixed(2)}`);
      // Cache hit but plan missing → force plan calibration in same session
      if (cached.complexity.level !== "low" && cached.needsPlan.p >= 0.5 && !cachedPlan) {
        pendingPlanState = state;
        tPlan0 = Date.now();
        return { message: { customType: "jev-policy", content: buildJevPlanInstruction(state, cached), display: false } };
      }
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

  // Risk + Plan gate — runs on every tool AFTER calibration; uses last calibration's is_risky + lastPlan
  pi.on("tool_call", async (event: any, ctx: any) => {
    const toolName = event.toolName as string;
    if (toolName === "jev_calibrate" || toolName === "jev_plan" || toolName === "jev_git") return undefined; // allow jev tools always
    const input = event.input as Record<string, unknown>;
    // No fallback: if not calibrated yet, block and ask for calibration first
    if (!lastPolicy) {
      if (pendingState) {
        // Still waiting for calibration — block until jev_calibrate called
        return { block: true, reason: "Jev calibration pending — pi model must call jev_calibrate first (Score/Noul via pi-model). This is NOT regular regex — it's pi-model System-One." };
      }
      return { block: true, reason: "No Jev calibration — cannot evaluate risk without pi-model via:pi-model" };
    }
    // 2-Tool Chain gate: if calibration says needs plan, block risky tools until jev_plan done
    if (lastPolicy && lastPolicy.needsPlan.p >= 0.5 && lastPolicy.complexity.level !== "low" && !lastPlan && pendingPlanState) {
      if (toolName === "bash" || toolName === "write" || toolName === "edit") {
        return { block: true, reason: "Jev plan pending — pi model must call jev_plan first (System-Two via pi-model). Calibration needs_plan>=0.5." };
      }
    }
    // Use last calibration's is_risky if state matches, else require fresh calibration is not needed —
    // For per-tool risk, the jev_calibrate already included is_risky for this state if model calibrated.
    // Per-step risk from plan overrides global pRisk when available.
    let pRisk = lastRisk?.decision.pRisk ?? 0;
    let via: string = lastRisk?.decision.via ?? "pi-model";
    let reason: string | undefined = lastRisk?.decision.reason;
    // Per-step risk lookup: match toolName to step.action
    if (lastPlan) {
      const step = lastPlan.steps.find((s: any) => s.action === toolName || (toolName === "bash" && s.action === "bash"));
      if (step) {
        pRisk = Math.max(pRisk, step.risk);
        via = "pi-model:plan";
        if (step.risk >= config.thresholds.risk) reason = `plan step ${step.id} pRisk=${step.risk.toFixed(2)} >= ${config.thresholds.risk}`;
        if (step.needsHuman) reason = `plan step ${step.id} needsHuman — confirm`;
      }
    }
    const decision = lastRisk?.decision;
    const block = pRisk >= config.thresholds.risk || (lastPlan?.steps.some((s: any) => s.needsHuman && s.action === toolName));
    if (block && (toolName === "bash" || toolName === "write" || toolName === "edit")) {
      const msg = reason ?? decision?.reason ?? `pi-model pRisk=${pRisk.toFixed(2)} >= ${config.thresholds.risk}`;
      if (!ctx.hasUI) return { block: true, reason: msg };
      const ok = await ctx.ui.confirm("Jev pi-model Gate", `${msg}\n\nTool: ${toolName}\nInput: ${JSON.stringify(input).slice(0, 500)}\nVia: ${via} — recalibrate if wrong.`);
      if (!ok) return { block: true, reason: `Blocked by pi-model Jev gate pRisk=${pRisk.toFixed(2)}` };
    }
    ctx.ui.setWidget("jev", [
      `policy:${lastPolicy?.complexity.level ?? "-"} via=pi-model`,
      `risk:${pRisk.toFixed(2)} via=${via}`,
      ...(lastPlan ? [`plan:${lastPlan.steps.length} steps via=pi-model`] : []),
      ...(lastGit?.hash ? [`git:${lastGit.hash.slice(0, 7)}`] : []),
    ]);
    return undefined;
  });

  pi.registerCommand("jev:status", {
    description: "Show last pi-model Jev calibration + plan + git (tool-based, no fallback)",
    handler: async (_a: string, ctx: any) => {
      ctx.ui.notify(`Jev pi-model (tool, no fallback)\n  provider: ${process.env.PI_PROVIDER}/${process.env.PI_MODEL}\n  policy: ${JSON.stringify(lastPolicy, null, 2)}\n  risk: ${JSON.stringify(lastRisk, null, 2)}\n  plan: ${JSON.stringify(lastPlan, null, 2)}\n  git: ${JSON.stringify(lastGit, null, 2)}`, "info");
    },
  });
  pi.registerCommand("jev:plan", {
    description: "Show last Jev plan",
    handler: async (_a: string, ctx: any) => {
      if (!lastPlan) { ctx.ui.notify("No Jev plan yet — trigger a task with needs_plan>=0.5 then call jev_plan", "info"); return; }
      ctx.ui.notify(formatPlanNotify(lastPlan), "info");
    },
  });
  pi.registerCommand("jev:git", {
    description: "Jev git — status/diff/log (usage: /jev:git status | diff | log 12)",
    handler: async (args: string, ctx: any) => {
      const a = (args.trim().split(/\s+/)[0] || "status") as JevGitParams["action"];
      const lim = parseInt(args.trim().split(/\s+/)[1] || "12", 10);
      const res = await handleJevGit(pi, { action: a as any, limit: isNaN(lim) ? 12 : lim } as any, { policy: lastPolicy, plan: lastPlan, state: pendingPlanState ?? pendingState });
      ctx.ui.notify(res.text, "info");
    },
  });
  pi.registerCommand("jev:log", {
    description: "Show git log via jev_git",
    handler: async (args: string, ctx: any) => {
      const lim = parseInt(args.trim() || "12", 10);
      const res = await handleJevGit(pi, { action: "log", limit: isNaN(lim) ? 12 : lim }, { policy: lastPolicy, plan: lastPlan, state: pendingState });
      ctx.ui.notify(res.text, "info");
    },
  });
  pi.registerCommand("jev:commit", {
    description: "Commit via jev_git (usage: /jev:commit optional message)",
    handler: async (args: string, ctx: any) => {
      const res = await handleJevGit(pi, { action: "commit", message: args.trim() || undefined }, { policy: lastPolicy, plan: lastPlan, state: pendingPlanState ?? pendingState });
      ctx.ui.notify(res.text, res.details?.error ? "warning" : "info");
    },
  });
  pi.registerCommand("jev:clear", { description: "Clear calibration cache", handler: async (_a: string, ctx: any) => { cache.clear(); lastPolicy = null; lastRisk = null; lastPlan = null; lastGit = null; pendingPlanState = null; hadGitCommitThisTurn = false; ctx.ui.notify("Jev cache cleared — next turn will recalibrate via pi-model", "info"); } });
}
