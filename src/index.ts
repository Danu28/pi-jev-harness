/**
 * pi-jev-harness — PI-MODEL Calibrated, TOOL-BASED, NO FALLBACK (NOT regular).
 * Flow: user prompt -> build Jev instruction -> pi model *calls* jev_calibrate tool
 * in same session with 5 parallel Questions (Score/Noul) -> via:pi-model.
 * No fetch, no PI_API_BASE, no auth.json, no Typesafe, no regex fallback.
 *
 * Why .ts imports: pi loader handles TS directly (allowImportingTsExtensions).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stateFromPrompt } from "./jev-client.ts";
import { resolveConfig } from "./harness/config.ts";
import { JevCache } from "./harness/cache.ts";
import {
  jevCalibrateSchema,
  calibrateToPolicy,
  calibrateToRisk,
  buildJevInstruction,
  type JevCalibrateParams,
} from "./harness/pi-classifier.ts";
import {
  jevPlanSchema,
  planToDecision,
  buildJevPlanInstruction,
  formatPlanDisplay,
  formatPlanNotify,
  type JevPlanParams,
  type PlanDecision,
} from "./harness/pi-planner.ts";
import {
  jevGitSchema,
  handleJevGit,
  autoCommitIfDirty,
  type JevGitParams,
} from "./harness/pi-git.ts";
import { evaluateGate, phaseOf } from "./harness/gate.ts";
import type { PolicyDecision, RiskDecision } from "./types.ts";

export default function (pi: ExtensionAPI): void {
  const config = resolveConfig(process.env as unknown as NodeJS.ProcessEnv);
  const cache = new JevCache(config.cacheTtlMs);
  let lastPolicy: PolicyDecision | null = null;
  let lastRisk: { decision: RiskDecision } | null = null;
  let lastPlan: PlanDecision | null = null;
  let lastGit: { hash?: string; action?: string } | null = null;
  let pendingState: string | null = null;
  let pendingPlanState: string | null = null;
  let t0 = 0;
  let tPlan0 = 0;
  let hadGitCommitThisTurn = false;

  (pi as any).registerTool({
    name: "jev_calibrate",
    label: "Jev Calibrate",
    description:
      "System-One Jev calibration: evaluate 5 parallel Questions (complexity Score + is_urgent/needs_plan/needs_human/is_risky Noul) for STATE. Call this BEFORE any other tool.",
    parameters: jevCalibrateSchema as unknown as Record<string, unknown>,
    async execute(_toolCallId: string, params: unknown) {
      const p = params as JevCalibrateParams;
      const latencyMs = Date.now() - t0;
      const policy = calibrateToPolicy(p, latencyMs);
      const risk = calibrateToRisk(p, config);
      lastPolicy = policy;
      lastRisk = { decision: risk };
      cache.set(`policy:${p.state.slice(0, 2000)}`, policy);
      (pi as unknown as { appendEntry?: (k: string, v: unknown) => void }).appendEntry?.("jev", {
        type: "policy",
        policy,
        calibration: p,
        at: Date.now(),
        provider: process.env.PI_PROVIDER,
        model: process.env.PI_MODEL,
      });
      const needsPlan = policy.needsPlan.p >= 0.5 && policy.complexity.level !== "low";
      if (needsPlan) {
        pendingPlanState = p.state;
        tPlan0 = Date.now();
      }
      const base = `calibrated via:pi-model complexity=${policy.complexity.level} score=${policy.complexity.score.toFixed(2)} urgent=${policy.isUrgent.p.toFixed(2)} needsPlan=${policy.needsPlan.p.toFixed(2)} risk=${risk.pRisk.toFixed(2)}`;
      const suffix = needsPlan
        ? "\n[JEV plan required next — call jev_plan for this STATE now]"
        : "";
      return {
        content: [{ type: "text", text: base + suffix }],
        details: { policy, risk, needsPlan },
      };
    },
  });

  (pi as any).registerTool({
    name: "jev_plan",
    label: "Jev Plan",
    description:
      "System-Two Jev plan: decompose STATE into 2-7 sequential steps with per-step risk/needsHuman. Call AFTER jev_calibrate when needs_plan>=0.5.",
    parameters: jevPlanSchema as unknown as Record<string, unknown>,
    async execute(_toolCallId: string, params: unknown) {
      const p = params as JevPlanParams;
      if (!lastPolicy)
        return {
          content: [{ type: "text", text: "blocked: must call jev_calibrate before jev_plan" }],
          details: { error: "calibrate first" },
        };
      const latencyMs = Date.now() - (tPlan0 || t0);
      const decision = planToDecision(p, latencyMs);
      lastPlan = decision;
      pendingPlanState = null;
      cache.set(`plan:${p.state.slice(0, 2000)}`, decision);
      (pi as unknown as { appendEntry?: (k: string, v: unknown) => void }).appendEntry?.("jev", {
        type: "plan",
        plan: decision,
        params: p,
        at: Date.now(),
        provider: process.env.PI_PROVIDER,
        model: process.env.PI_MODEL,
      });
      const pretty = formatPlanDisplay(p, decision);
      return {
        content: [{ type: "text", text: pretty }],
        details: { plan: decision },
      };
    },
  });

  (pi as any).registerTool({
    name: "jev_git",
    label: "Jev Git",
    description:
      "Agent-friendly git for Jev harness — status/diff/log/commit/revert/init. Commit auto-generates conventional message from Jev calibration/plan if message omitted. Call commit at end of task for audit/revert. Also try agent_settled auto-commit.",
    parameters: jevGitSchema as unknown as Record<string, unknown>,
    async execute(_toolCallId: string, params: unknown) {
      const p = params as JevGitParams;
      const res = await handleJevGit(
        pi as unknown as {
          exec?: (
            cmd: string,
            args: string[],
          ) => Promise<{ code?: number; stdout?: string; stderr?: string }>;
        },
        p,
        { policy: lastPolicy, plan: lastPlan, state: pendingPlanState ?? pendingState },
      );
      if (p.action === "commit" && !res.details?.error && !res.details?.clean) {
        hadGitCommitThisTurn = true;
        lastGit = res.details as { hash?: string };
      }
      (pi as unknown as { appendEntry?: (k: string, v: unknown) => void }).appendEntry?.("jev", {
        type: "git",
        action: p.action,
        params: p,
        result: res.details,
        at: Date.now(),
      });
      return { content: [{ type: "text", text: res.text }], details: res.details };
    },
  });

  pi.on("session_start", async (_e: unknown, ctx: unknown) => {
    const c = ctx as {
      ui: {
        setStatus: (k: string, v: string) => void;
        theme: { fg: (a: string, b: string) => string };
      };
    };
    c.ui.setStatus(
      "jev",
      c.ui.theme.fg(
        "success",
        `jev:pi-model ${process.env.PI_PROVIDER ?? "pi"}/${process.env.PI_MODEL ?? config.model}`,
      ),
    );
  });
  pi.on("agent_start", async () => {
    hadGitCommitThisTurn = false;
  });
  pi.on("agent_settled", async (_e: unknown, ctx: unknown) => {
    if (hadGitCommitThisTurn) return;
    try {
      const res = await autoCommitIfDirty(
        pi as unknown as {
          exec?: (
            cmd: string,
            args: string[],
          ) => Promise<{ code?: number; stdout?: string; stderr?: string }>;
        },
        { policy: lastPolicy, plan: lastPlan, state: pendingPlanState ?? pendingState },
      );
      if (res.committed) {
        lastGit = { action: "commit", hash: res.hash };
        hadGitCommitThisTurn = true;
        (pi as unknown as { appendEntry?: (k: string, v: unknown) => void }).appendEntry?.("jev", {
          type: "git:auto",
          hash: res.hash,
          at: Date.now(),
        });
        (ctx as { ui?: { notify: (m: string, l: string) => void } })?.ui?.notify(
          `🌿 Jev auto-commit ${res.hash?.slice(0, 7)} — ${res.text?.split("\n")[0]}`,
          "info",
        );
      }
    } catch {}
  });
  pi.on("session_shutdown", async (_e: unknown, ctx: unknown) => {
    if (hadGitCommitThisTurn) return;
    try {
      const res = await autoCommitIfDirty(
        pi as unknown as {
          exec?: (
            cmd: string,
            args: string[],
          ) => Promise<{ code?: number; stdout?: string; stderr?: string }>;
        },
        { policy: lastPolicy, plan: lastPlan, state: pendingPlanState ?? pendingState },
      );
      if (res.committed)
        (ctx as { ui?: { notify: (m: string, l: string) => void } })?.ui?.notify(
          `🌿 Jev shutdown auto-commit ${res.hash?.slice(0, 7)}`,
          "info",
        );
    } catch {}
  });

  pi.on("before_agent_start", async (event: unknown) => {
    const ev = event as { prompt?: string; message?: { content?: string } };
    const prompt: string = ev.prompt ?? ev.message?.content ?? "";
    if (!prompt || String(prompt).startsWith("[JEV")) return;
    const state = stateFromPrompt(String(prompt));
    const key = `policy:${state.slice(0, 2000)}`;
    const planKey = `plan:${state.slice(0, 2000)}`;
    const cached = cache.get<PolicyDecision>(key);
    if (cached) {
      lastPolicy = cached;
      const cachedPlan = cache.get<PlanDecision>(planKey);
      if (cachedPlan) lastPlan = cachedPlan;
      if (cached.complexity.level !== "low" && cached.needsPlan.p >= 0.5 && !cachedPlan) {
        pendingPlanState = state;
        tPlan0 = Date.now();
        return {
          message: {
            customType: "jev-policy",
            content: buildJevPlanInstruction(state, cached),
            display: false,
          },
        };
      }
      const hints: string[] = [];
      if (cached.complexity.level !== "low" && cached.needsPlan.p >= 0.5) {
        if (cachedPlan)
          hints.push(
            `complexity=${cached.complexity.level} via=pi-model — plan cached ${cachedPlan.steps.length} steps`,
          );
        else hints.push(`complexity=${cached.complexity.level} via=pi-model — plan recommended`);
      }
      if (cached.isUrgent.p >= config.thresholds.urgent)
        hints.push(`urgent p=${cached.isUrgent.p.toFixed(2)}`);
      if (hints.length)
        return {
          message: {
            customType: "jev-policy",
            content: `[JEV pi-model cached] ${hints.join("; ")}`,
            display: false,
          },
        };
      return;
    }
    pendingState = state;
    t0 = Date.now();
    return {
      message: {
        customType: "jev-policy",
        content: buildJevInstruction(state),
        display: false,
      },
    };
  });

  pi.on("tool_call", async (event: unknown, ctx: unknown) => {
    const ev = event as { toolName: string; input: Record<string, unknown> };
    const toolName = ev.toolName;
    const input = ev.input;
    const gate = evaluateGate(
      config,
      { policy: lastPolicy, risk: lastRisk, plan: lastPlan, pendingState, pendingPlanState },
      toolName,
    );
    const c = ctx as {
      hasUI?: boolean;
      ui: {
        confirm: (t: string, m: string) => Promise<boolean>;
        setWidget: (k: string, v: string[]) => void;
      };
    };
    if (!gate.block) {
      // still update widget for non-blocking tools
      if (lastPolicy) {
        c.ui.setWidget("jev", [
          `policy:${lastPolicy.complexity.level} via=pi-model`,
          `risk:${gate.pRisk.toFixed(2)} via=${gate.via} phase:${phaseOf({ policy: lastPolicy, risk: lastRisk, plan: lastPlan, pendingState, pendingPlanState })}`,
          ...(lastPlan ? [`plan:${lastPlan.steps.length} steps via=pi-model`] : []),
          ...(lastGit?.hash ? [`git:${lastGit.hash.slice(0, 7)}`] : []),
        ]);
      }
      return undefined;
    }
    // blocking cases
    if (toolName === "bash" || toolName === "write" || toolName === "edit") {
      const msg =
        gate.reason ?? `pi-model pRisk=${gate.pRisk.toFixed(2)} >= ${config.thresholds.risk}`;
      if (!c.hasUI) return { block: true, reason: msg };
      const ok = await c.ui.confirm(
        "Jev pi-model Gate",
        `${msg}\n\nTool: ${toolName}\nInput: ${JSON.stringify(input).slice(0, 500)}\nVia: ${gate.via} — recalibrate if wrong.`,
      );
      if (!ok)
        return {
          block: true,
          reason: `Blocked by pi-model Jev gate pRisk=${gate.pRisk.toFixed(2)}`,
        };
      return undefined;
    }
    return { block: true, reason: gate.reason };
  });

  pi.registerCommand("jev:status", {
    description: "Show last pi-model Jev calibration + plan + git (tool-based, no fallback)",
    handler: async (_a: string, ctx: unknown) => {
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
        `Jev pi-model (tool, no fallback)\n  provider: ${process.env.PI_PROVIDER}/${process.env.PI_MODEL}\n  phase: ${phaseOf({ policy: lastPolicy, risk: lastRisk, plan: lastPlan, pendingState, pendingPlanState })}\n  policy: ${JSON.stringify(lastPolicy, null, 2)}\n  risk: ${JSON.stringify(lastRisk, null, 2)}\n  plan: ${JSON.stringify(lastPlan, null, 2)}\n  git: ${JSON.stringify(lastGit, null, 2)}`,
        "info",
      );
    },
  });
  pi.registerCommand("jev:plan", {
    description: "Show last Jev plan",
    handler: async (_a: string, ctx: unknown) => {
      if (!lastPlan) {
        (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
          "No Jev plan yet — trigger a task with needs_plan>=0.5 then call jev_plan",
          "info",
        );
        return;
      }
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
        formatPlanNotify(lastPlan),
        "info",
      );
    },
  });
  pi.registerCommand("jev:git", {
    description: "Jev git — status/diff/log (usage: /jev:git status | diff | log 12)",
    handler: async (args: string, ctx: unknown) => {
      const a = (args.trim().split(/\s+/)[0] || "status") as JevGitParams["action"];
      const lim = parseInt(args.trim().split(/\s+/)[1] || "12", 10);
      const res = await handleJevGit(
        pi as unknown as {
          exec?: (
            cmd: string,
            args: string[],
          ) => Promise<{ code?: number; stdout?: string; stderr?: string }>;
        },
        { action: a as never, limit: isNaN(lim) ? 12 : lim } as JevGitParams,
        { policy: lastPolicy, plan: lastPlan, state: pendingPlanState ?? pendingState },
      );
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(res.text, "info");
    },
  });
  pi.registerCommand("jev:log", {
    description: "Show git log via jev_git",
    handler: async (args: string, ctx: unknown) => {
      const lim = parseInt(args.trim() || "12", 10);
      const res = await handleJevGit(
        pi as unknown as {
          exec?: (
            cmd: string,
            args: string[],
          ) => Promise<{ code?: number; stdout?: string; stderr?: string }>;
        },
        { action: "log", limit: isNaN(lim) ? 12 : lim },
        { policy: lastPolicy, plan: lastPlan, state: pendingState },
      );
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(res.text, "info");
    },
  });
  pi.registerCommand("jev:commit", {
    description: "Commit via jev_git (usage: /jev:commit optional message)",
    handler: async (args: string, ctx: unknown) => {
      const res = await handleJevGit(
        pi as unknown as {
          exec?: (
            cmd: string,
            args: string[],
          ) => Promise<{ code?: number; stdout?: string; stderr?: string }>;
        },
        { action: "commit", message: args.trim() || undefined },
        { policy: lastPolicy, plan: lastPlan, state: pendingPlanState ?? pendingState },
      );
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
        res.text,
        res.details?.error ? "warning" : "info",
      );
    },
  });
  pi.registerCommand("jev:clear", {
    description: "Clear calibration cache",
    handler: async (_a: string, ctx: unknown) => {
      cache.clear();
      lastPolicy = null;
      lastRisk = null;
      lastPlan = null;
      lastGit = null;
      pendingPlanState = null;
      hadGitCommitThisTurn = false;
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
        "Jev cache cleared — next turn will recalibrate via pi-model",
        "info",
      );
    },
  });
}
