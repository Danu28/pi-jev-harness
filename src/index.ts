/**
 * pi-jev-harness — PI-MODEL Calibrated, TOOL-BASED, NO FALLBACK (NOT regular).
 * Enhanced: trivial bypass, compress, tiered instruction, SEPARATE calibrate then plan (once per task),
 * cursor, persistent cache, actionable widget, card status, telemetry, safe clear.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stateFromPrompt, isTrivialPrompt, compressState } from "./jev-client.ts";
import { resolveConfig, parseThresholdArgs } from "./harness/config.ts";
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
  formatNextStep,
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
import { actionableWidgetLines as buildWidgetLines, cardStatus as buildCardStatus, nextActionHint as buildNextHint } from "./extension/ui.ts";
import { statusHandler, planHandler, nextHandler, helpHandler, costHandler, configHandler, gitHandler } from "./extension/commands.ts";
import { jevCalibrateExecute, jevPlanExecute, jevGitExecute } from "./extension/tools.ts";
import type { PolicyDecision, RiskDecision, JevTelemetry } from "./types.ts";

export default function (pi: ExtensionAPI): void {
  let config = resolveConfig(process.env as unknown as NodeJS.ProcessEnv);
  const cache = new JevCache(config.cacheTtlMs);
  // cache is in-memory LRU only — file persistence removed (was write-only, never hydrated)
  let lastPolicy: PolicyDecision | null = null;
  let lastRisk: { decision: RiskDecision } | null = null;
  let lastPlan: PlanDecision | null = null;
  let lastGit: { hash?: string; action?: string } | null = null;
  let pendingState: string | null = null;
  let pendingPlanState: string | null = null;
  let t0 = 0;
  let tPlan0 = 0;
  let hadGitCommitThisTurn = false;
  let turnId = 0;
  let lastCalibrateTurn = 0; // once-per-task guard for jev_calibrate
  let lastPlanTurn = 0; // once-per-task guard for jev_plan (separate from calibrate)
  let lastTelemetry: JevTelemetry | null = null;
  let lastTrivialBypass = false;
  let widgetDebounceUntil = 0;
  let clearBackup: { policy: PolicyDecision | null; plan: PlanDecision | null; at: number } | null =
    null;
  let lastWasLowRisk = true; // tier hint for shouldUseShortInstruction

  const append = (entry: unknown) => {
    try {
      (pi as unknown as { appendEntry?: (k: string, v: unknown) => void }).appendEntry?.(
        "jev",
        entry,
      );
    } catch {}
  };

  function uiState(): import("./extension/ui.ts").UiState {
    return { policy: lastPolicy, risk: lastRisk, plan: lastPlan, git: lastGit, pendingState, pendingPlanState, telemetry: lastTelemetry, trivialBypass: lastTrivialBypass, turnId, cache, config };
  }
  function nextActionHint(): string { return buildNextHint(uiState()); }
  function actionableWidgetLines(gate: { pRisk: number; via: string; warning?: string }): string[] { return buildWidgetLines(uiState(), gate); }

  function cardStatus(): string { return buildCardStatus(uiState()); }

  const toolDeps: import("./extension/tools.ts").ToolDeps = {
    pi: pi as unknown,
    config,
    cache,
    get: () => ({ policy: lastPolicy, risk: lastRisk, plan: lastPlan, git: lastGit, pendingState, pendingPlanState, t0, tPlan0, turnId, lastCalibrateTurn, lastPlanTurn, hadGitCommitThisTurn, telemetry: lastTelemetry, lastWasLowRisk }),
    set: (patch) => {
      if (patch.policy !== undefined) lastPolicy = patch.policy as PolicyDecision | null;
      if (patch.risk !== undefined) lastRisk = patch.risk as { decision: RiskDecision } | null;
      if (patch.plan !== undefined) lastPlan = patch.plan as PlanDecision | null;
      if (patch.git !== undefined) lastGit = patch.git as { hash?: string; action?: string } | null;
      if (patch.pendingState !== undefined) pendingState = patch.pendingState;
      if (patch.pendingPlanState !== undefined) pendingPlanState = patch.pendingPlanState;
      if (patch.t0 !== undefined) t0 = patch.t0;
      if (patch.tPlan0 !== undefined) tPlan0 = patch.tPlan0;
      if (patch.lastCalibrateTurn !== undefined) lastCalibrateTurn = patch.lastCalibrateTurn;
      if (patch.lastPlanTurn !== undefined) lastPlanTurn = patch.lastPlanTurn;
      if (patch.hadGitCommitThisTurn !== undefined) hadGitCommitThisTurn = patch.hadGitCommitThisTurn;
      if (patch.telemetry !== undefined) lastTelemetry = patch.telemetry;
      if (patch.lastWasLowRisk !== undefined) lastWasLowRisk = patch.lastWasLowRisk;
    },
    append,
    nextHint: nextActionHint,
  };

  // ── tools ──────────────────────────────────────────────────────────────
  (pi as any).registerTool({
    name: "jev_calibrate",
    label: "Jev Calibrate",
    description:
      "System-One Jev calibration: evaluate 5 parallel Questions (complexity Score + is_urgent/needs_plan/needs_human/is_risky Noul) for STATE. Call this BEFORE any other tool. Do NOT merge plan — call jev_plan separately next if needs_plan>=0.5 (once per task).",
    parameters: jevCalibrateSchema as unknown as Record<string, unknown>,
    execute: jevCalibrateExecute(toolDeps) as unknown as (id: string, params: unknown) => Promise<unknown>,
  });

  (pi as any).registerTool({
    name: "jev_plan",
    label: "Jev Plan",
    description:
      "System-Two Jev plan: decompose STATE into 2-7 sequential steps with per-step risk/needsHuman. Call AFTER jev_calibrate when needs_plan>=0.5 (separate, once per task, never merged). Prefer smart_bundle for ≤8 files.",
    parameters: jevPlanSchema as unknown as Record<string, unknown>,
    execute: jevPlanExecute(toolDeps) as unknown as (id: string, params: unknown) => Promise<unknown>,
  });

  (pi as any).registerTool({
    name: "jev_git",
    label: "Jev Git",
    description:
      "Agent-friendly git for Jev harness — status/diff/log/commit/revert/init. Commit auto-generates conventional message from Jev calibration/plan if message omitted.",
    parameters: jevGitSchema as unknown as Record<string, unknown>,
    execute: jevGitExecute(toolDeps) as unknown as (id: string, params: unknown) => Promise<unknown>,
  });

  // git wrappers removed — use jev_git {action:"status"|"commit"|"diff"|"log"} (single tool, same impl)

  pi.on("session_start", async (_e: unknown, ctx: unknown) => {
    const c = ctx as {
      ui: {
        setStatus: (k: string, v: string) => void;
        theme: { fg: (a: string, b: string) => string };
        notify?: (m: string, l: string) => void;
      };
    };
    c.ui.setStatus(
      "jev",
      c.ui.theme.fg(
        "success",
        `jev:pi-model ${process.env.PI_PROVIDER ?? "pi"}/${process.env.PI_MODEL ?? config.model}`,
      ),
    );
    // onboarding hint once per workspace
    try {
      if (!lastPolicy && turnId === 0) {
        // lightweight hint after start
        setTimeout(() => {
          try {
            (c.ui.notify as unknown as (m: string, l: string) => void)?.(
              "Jev harness ready — calibration via pi-model. Try /jev:status · /jev:help",
              "info",
            );
          } catch {}
        }, 600);
      }
    } catch {}
  });
  pi.on("agent_start", async () => {
    hadGitCommitThisTurn = false;
    turnId++;
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
        append({ type: "git:auto", hash: res.hash, at: Date.now() });
        (ctx as { ui?: { notify: (m: string, l: string) => void } })?.ui?.notify(
          `🌿 Jev auto-commit ${res.hash?.slice(0, 7)} — ${res.text?.split("\n")[0]}  (undo: /jev:git revert ${res.hash?.slice(0, 7)})`,
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
          `🌿 Jev shutdown auto-commit ${res.hash?.slice(0, 7)}  (undo: /jev:git revert ${res.hash?.slice(0, 7)})`,
          "info",
        );
    } catch {}
  });

  pi.on("before_agent_start", async (event: unknown) => {
    const ev = event as { prompt?: string; message?: { content?: string } };
    const prompt: string = ev.prompt ?? ev.message?.content ?? "";
    if (!prompt || String(prompt).startsWith("[JEV")) return;
    // AF-01 trivial bypass: delete ceremony that shouldn't exist
    if (isTrivialPrompt(prompt)) {
      lastTrivialBypass = true;
      // ephemeral low policy — not cached, low risk, no plan needed
      const ephemeral: PolicyDecision = {
        complexity: { level: "low", score: 0.12, confidence: 0.85, via: "pi-model" },
        isUrgent: { p: 0.05, confidence: 0.85, via: "pi-model" },
        needsPlan: { p: 0.05, confidence: 0.85, via: "pi-model" },
        needsHuman: { p: 0.02, confidence: 0.85, via: "pi-model" },
        latencyMs: 0,
      };
      lastPolicy = ephemeral;
      lastRisk = { decision: { block: false, pRisk: 0.06, confidence: 0.85, via: "pi-model" } };
      lastTelemetry = {
        compressedChars: prompt.length,
        latencyMs: 0,
        cached: false,
        trivialBypass: true,
      };
      append({ type: "policy:trivial-bypass", prompt: prompt.slice(0, 120), at: Date.now() });
      // don't inject calibration instruction — save ~450 tokens
      return;
    }
    lastTrivialBypass = false;
    const rawState = stateFromPrompt(String(prompt));
    const state = compressState(rawState, 1400);
    const key = `policy:${state.slice(0, 2000)}`;
    const planKey = `plan:${state.slice(0, 2000)}`;
    // AF-07 idempotent: if same turn already calibrated, reuse without re-inject
    const cached = cache.get<PolicyDecision>(key);
    if (cached) {
      lastPolicy = cached;
      lastWasLowRisk = (cached as PolicyDecision).complexity.level === "low";
      const cachedPlan = cache.get<PlanDecision>(planKey);
      if (cachedPlan) {
        // restore cursor persistence
        lastPlan = cachedPlan;
      }
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
            `complexity=${cached.complexity.level} via=pi-model — plan cached ${cachedPlan.steps.length} steps — ${formatNextStep(cachedPlan).split("\n")[0]}`,
          );
        else hints.push(`complexity=${cached.complexity.level} via=pi-model — plan recommended`);
      }
      if (cached.isUrgent.p >= config.thresholds.urgent)
        hints.push(`urgent p=${cached.isUrgent.p.toFixed(2)}`);
      lastTelemetry = {
        compressedChars: state.length,
        latencyMs: 0,
        cached: true,
        trivialBypass: false,
      };
      if (hints.length)
        return {
          message: {
            customType: "jev-policy",
            content: `[JEV pi-model cached] ${hints.join("; ")}  next: ${nextActionHint()}`,
            display: false,
          },
        };
      return;
    }
    pendingState = state;
    t0 = Date.now();
    const instr = buildJevInstruction(state, { compressedChars: 1400 });
    lastTelemetry = {
      compressedChars: state.length,
      latencyMs: 0,
      cached: false,
      trivialBypass: false,
    };
    return {
      message: {
        customType: "jev-policy",
        content: instr,
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
    // cursor advance for non-blocking tools that match plan step
    if (!gate.block && lastPlan && gate.step) {
      const idx = lastPlan.steps.findIndex((s) => s.id === gate.step!.id);
      if (idx !== -1 && lastPlan.cursor !== undefined && idx === lastPlan.cursor) {
        // advance cursor after successful tool (optimistic — will be confirmed on next tool_call)
        // only advance if not needsHuman (needs confirm)
        if (!gate.step.needsHuman) {
          lastPlan.done = [...(lastPlan.done ?? []), gate.step.id];
          lastPlan.cursor = idx + 1;
          // persist updated plan to cache
          const st = pendingPlanState ?? pendingState ?? lastPlan.state;
          if (st) cache.set(`plan:${st.slice(0, 2000)}`, lastPlan);
        }
      } else if (gate.warning) {
        // out-of-order warning already in gate — will surface via widget
      }
    }
    if (!gate.block) {
      // CE-06 debounced widget
      if (lastPolicy) {
        const now = Date.now();
        if (now >= widgetDebounceUntil) {
          widgetDebounceUntil = now + 300;
          c.ui.setWidget("jev", actionableWidgetLines(gate));
        }
      }
      return undefined;
    }
    // blocking cases — enrich with typed codes
    const blockDetails = {
      code: gate.code,
      hint: gate.hint,
      retryable: gate.retryable,
      pRisk: gate.pRisk,
      via: gate.via,
      step: gate.step,
      nextAction: nextActionHint(),
      warning: gate.warning,
    };
    if (
      toolName === "bash" ||
      toolName === "write" ||
      toolName === "edit" ||
      toolName === "smart_bundle" ||
      toolName === "smart_edit"
    ) {
      const msg =
        gate.reason ?? `pi-model pRisk=${gate.pRisk.toFixed(2)} >= ${config.thresholds.risk}`;
      const ctxMsg = gate.step
        ? `Step ${gate.step.id} (${gate.step.action}: ${gate.step.title}) — `
        : "";
      const hintLine = gate.hint ? `\nHint: ${gate.hint}` : "";
      const warnLine = gate.warning ? `\nWarn: ${gate.warning}` : "";
      const fullMsg = `${ctxMsg}${msg}${hintLine}${warnLine}\nNext: ${nextActionHint()}`;
      if (!c.hasUI)
        return { block: true, reason: fullMsg, details: blockDetails } as unknown as undefined;
      const conciseInput = JSON.stringify(input).slice(0, 250);
      const conciseMsg = fullMsg.length > 400 ? fullMsg.slice(0, 397) + "…" : fullMsg;
      const ok = await c.ui.confirm(
        "Jev pi-model Gate",
        `${conciseMsg}\n\nTool: ${toolName}\nInput: ${conciseInput}${conciseInput.length >= 250 ? "…" : ""}\nVia: ${gate.via} — recalibrate if wrong.`,
      );
      if (!ok)
        return {
          block: true,
          reason: `Blocked by pi-model Jev gate pRisk=${gate.pRisk.toFixed(2)} code=${gate.code ?? "RISK_HIGH"}`,
        } as unknown as undefined;
      return undefined;
    }
    return { block: true, reason: gate.reason, details: blockDetails } as unknown as undefined;
  });

  // ── commands (delegated — s3 wiring) ──
  const getState = () => ({ policy: lastPolicy, risk: lastRisk, plan: lastPlan, git: lastGit, pendingState, pendingPlanState, telemetry: lastTelemetry, trivialBypass: lastTrivialBypass, turnId, cache, config, clearBackup });
  pi.registerCommand("jev:status", { description: "Show last pi-model Jev calibration + plan + git — card view (add --json for raw)", handler: statusHandler(getState as never, cardStatus) });
  pi.registerCommand("jev:plan", { description: "Show last Jev plan", handler: planHandler(getState as never) });
  pi.registerCommand("jev:next", { description: "Show next plan step + hint", handler: nextHandler(getState as never) });
  pi.registerCommand("jev:help", { description: "Jev harness help (all commands & tools)", handler: helpHandler() });
  pi.registerCommand("jev:cost", { description: "Show Jev token/latency telemetry", handler: costHandler(getState as never) });
  pi.registerCommand("jev:config", { description: "Tune thresholds live (usage: /jev:config risk 0.80 urgent 0.85)", handler: configHandler(getState as never) });
  pi.registerCommand("jev:resume", { description: "Resume last plan cursor (alias of /jev:next)", handler: nextHandler(getState as never) });
  pi.registerCommand("jev:git", { description: "Jev git — status/diff/log/commit/revert/init (usage: /jev:git status | diff | log 12 | commit | revert <hash> | init)", handler: gitHandler(pi as unknown as never, getState as never) });
  // aliases /jev:log and /jev:commit removed — use /jev:git log|commit (single surface)
  pi.registerCommand("jev:clear", {
    description: "Clear calibration cache (use --confirm; --restore to undo)",
    handler: async (a: string, ctx: unknown) => {
      const args = a.trim();
      if (args === "--restore" || args === "restore") {
        if (!clearBackup) {
          (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
            "No backup to restore",
            "info",
          );
          return;
        }
        lastPolicy = clearBackup.policy;
        lastPlan = clearBackup.plan;
        (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
          "Jev cache restored from backup",
          "info",
        );
        return;
      }
      if (args !== "--confirm") {
        (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
          `Jev clear — this will clear policy/plan/cache. Run /jev:clear --confirm to proceed. Backup will be kept for /jev:clear --restore.`,
          "info",
        );
        return;
      }
      clearBackup = { policy: lastPolicy, plan: lastPlan, at: Date.now() };
      cache.clear();
      lastPolicy = null;
      lastRisk = null;
      lastPlan = null;
      lastGit = null;
      pendingPlanState = null;
      hadGitCommitThisTurn = false;
      lastTrivialBypass = false;
      lastCalibrateTurn = 0;
      lastPlanTurn = 0;
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
        "Jev cache cleared — next turn will recalibrate via pi-model (backup kept: /jev:clear --restore)",
        "info",
      );
    },
  });
}
