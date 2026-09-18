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
import type { PolicyDecision, RiskDecision, JevTelemetry } from "./types.ts";

export default function (pi: ExtensionAPI): void {
  let config = resolveConfig(process.env as unknown as NodeJS.ProcessEnv);
  const cache = new JevCache(config.cacheTtlMs);
  // PR-01 light persist: write-through to .pi/jev-cache.json (fire-and-forget)
  function persistCache() {
    try {
      import("node:fs")
        .then((m) => {
          const fs = m as unknown as {
            promises: {
              mkdir: (p: string, o: unknown) => Promise<void>;
              writeFile: (p: string, d: string, e: string) => Promise<void>;
            };
          };
          fs.promises
            .mkdir(".pi", { recursive: true })
            .catch(() => {})
            .then(() => {
              const entries = (
                cache as unknown as { entries: () => Array<[string, { v: unknown; exp: number }]> }
              )
                .entries()
                .slice(0, 120);
              const arr = entries.map(([k, e]) => [k, e.v, e.exp] as const);
              fs.promises
                .writeFile(".pi/jev-cache.json", JSON.stringify(arr).slice(0, 200000), "utf8")
                .catch(() => {});
            });
        })
        .catch(() => {});
    } catch {}
  }
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
  let lastWasLowRisk = true;
  void lastWasLowRisk; // tier hint for shouldUseShortInstruction — suppress unused-var (wired via buildJevInstruction opts in future)

  // persistent cache hydration (best-effort, no hard deps)
  try {
    // pi cache API if available
    const cached = (pi as unknown as { loadCache?: () => unknown }).loadCache?.();
    void cached;
  } catch {}

  const append = (entry: unknown) => {
    try {
      (pi as unknown as { appendEntry?: (k: string, v: unknown) => void }).appendEntry?.(
        "jev",
        entry,
      );
    } catch {}
  };

  function nextActionHint(): string {
    const ph = phaseOf({
      policy: lastPolicy,
      risk: lastRisk,
      plan: lastPlan,
      pendingState,
      pendingPlanState,
    });
    if (ph === "awaitingCalibrate") return "call jev_calibrate";
    if (ph === "awaitingPlan") return "call jev_plan (separate, once per task)";
    if (lastPlan && lastPlan.cursor < lastPlan.steps.length) {
      const nxt = lastPlan.steps[lastPlan.cursor];
      return `run ${nxt.action} for ${nxt.id}: ${nxt.title}`;
    }
    if (lastPlan && lastPlan.cursor >= lastPlan.steps.length) return "call jev_git commit";
    return "proceed with tool";
  }

  function actionableWidgetLines(gate: { pRisk: number; via: string; warning?: string }): string[] {
    const ph = phaseOf({
      policy: lastPolicy,
      risk: lastRisk,
      plan: lastPlan,
      pendingState,
      pendingPlanState,
    });
    if (!lastPolicy) {
      if (lastTrivialBypass)
        return [`jev: trivial bypass • no calibrate (phase:${ph})`, `next: ${nextActionHint()}`];
      return [`jev: awaiting jev_calibrate · phase:${ph}`, `next: ${nextActionHint()}`];
    }
    const risk = gate.pRisk.toFixed(2);
    const base = `jev: ${lastPolicy.complexity.level} · risk ${risk} · ${ph}`;
    const extras: string[] = [];
    if (lastPlan) {
      const cur = lastPlan.cursor ?? 0;
      const total = lastPlan.steps.length;
      const nxt = cur < total ? `${lastPlan.steps[cur].id} ${lastPlan.steps[cur].action}` : "done";
      extras.push(`plan:${cur}/${total} next:${nxt}`);
    }
    if (lastGit?.hash) extras.push(`git:${lastGit.hash.slice(0, 7)}`);
    if (lastTelemetry) {
      const tot = lastTelemetry.compressedChars;
      extras.push(
        `${tot}ch · ${lastTelemetry.cached ? "cached" : `${lastTelemetry.latencyMs}ms`} · ${gate.via}`,
      );
    } else {
      extras.push(`via:${gate.via}`);
    }
    const noEmojiW =
      process.env.PI_NO_EMOJI === "1" ||
      process.env.NO_EMOJI === "1" ||
      process.env.NO_COLOR === "1";
    if (gate.warning) extras.push(`${noEmojiW ? "[warn]" : "⚠"} ${gate.warning.slice(0, 60)}`);
    const second = extras.join(" · ");
    const maxSecond = 120;
    return [base, second.length > maxSecond ? second.slice(0, maxSecond - 1) + "…" : second];
  }

  function cardStatus(): string {
    const noEmoji =
      process.env.PI_NO_EMOJI === "1" ||
      process.env.NO_EMOJI === "1" ||
      process.env.NO_COLOR === "1";
    const hdr = noEmoji ? "[jev] pi-model (tool, no fallback)" : "JeV pi-model (tool, no fallback)";
    const prov = `${process.env.PI_PROVIDER ?? "pi"}/${process.env.PI_MODEL ?? config.model}`;
    const ph = phaseOf({
      policy: lastPolicy,
      risk: lastRisk,
      plan: lastPlan,
      pendingState,
      pendingPlanState,
    });
    const lines: string[] = [];
    lines.push(`${hdr}`);
    lines.push(`  provider: ${prov}  ·  phase: ${ph}  ·  turn: ${turnId}`);
    if (!lastPolicy) {
      lines.push(
        `  policy: (none)${lastTrivialBypass ? " — trivial bypass active (no calibrate needed)" : ` — awaiting jev_calibrate (phase: ${ph})`}`,
      );
    } else {
      const c = lastPolicy.complexity;
      const badge =
        c.level === "high"
          ? noEmoji
            ? "[high]"
            : "🔴 high"
          : c.level === "medium"
            ? noEmoji
              ? "[med]"
              : "🟡 medium"
            : noEmoji
              ? "[low]"
              : "🟢 low";
      lines.push(
        `  policy: ${badge} score ${c.score.toFixed(2)} · urgent ${lastPolicy.isUrgent.p.toFixed(2)} · needsPlan ${lastPolicy.needsPlan.p.toFixed(2)} · risk ${lastRisk?.decision.pRisk.toFixed(2) ?? "-"} via ${lastRisk?.decision.via ?? "pi-model"} · conf ${(c.confidence * 100).toFixed(0)}%`,
      );
    }
    if (lastPlan) {
      const cur = lastPlan.cursor ?? 0;
      const tot = lastPlan.steps.length;
      const rawBar = "▓".repeat(Math.min(cur, tot)) + "░".repeat(Math.max(0, tot - cur));
      const bar = noEmoji ? `[${cur}/${tot}]` : rawBar;
      lines.push(
        `  plan: ${cur}/${tot} ${bar}  maxRisk ${lastPlan.maxRisk.toFixed(2)} via ${lastPlan.via}`,
      );
      lines.push(`  next: ${formatNextStep(lastPlan).split("\n")[0]}`);
      if (lastPlan.reasoning) lines.push(`  why: ${lastPlan.reasoning}`);
    } else if (
      lastPolicy &&
      lastPolicy.needsPlan.p >= 0.5 &&
      lastPolicy.complexity.level !== "low"
    ) {
      lines.push(`  plan: pending — call jev_plan (separate, once per task)`);
    } else {
      lines.push(`  plan: —`);
    }
    if (lastGit?.hash)
      lines.push(
        `  git: ${lastGit.hash.slice(0, 7)} · ${lastGit.action ?? "commit"}  (undo: /jev:git revert ${lastGit.hash.slice(0, 7)})`,
      );
    else lines.push(`  git: —  (no commits yet)`);
    if (lastTelemetry) {
      const hr = cache.getStats().hitRate;
      const st = cache.getStats();
      lines.push(
        `  cost: ${lastTelemetry.compressedChars}ch · ${lastTelemetry.latencyMs}ms · cached=${lastTelemetry.cached} · hitRate ${(hr * 100).toFixed(0)}% · cache ${st.size} entries`,
      );
    } else {
      const st = cache.getStats();
      lines.push(
        `  cost: —  (cache ${st.size} entries · hitRate ${(st.hitRate * 100).toFixed(0)}%)`,
      );
    }
    lines.push(`  nextAction: ${nextActionHint()}`);
    lines.push(
      `  thresholds: risk ${config.thresholds.risk} · urgent ${config.thresholds.urgent}  (/jev:config to tune)`,
    );
    lines.push(
      `  tips: /jev:next /jev:plan /jev:cost /jev:help · /jev:resume · /jev:git · /jev:clear`,
    );
    if (lastTrivialBypass)
      lines.push(`  note: trivial prompt — calibration bypassed (token saved ~450)`);
    return lines.join("\n");
  }

  // ── tools ──────────────────────────────────────────────────────────────
  (pi as any).registerTool({
    name: "jev_calibrate",
    label: "Jev Calibrate",
    description:
      "System-One Jev calibration: evaluate 5 parallel Questions (complexity Score + is_urgent/needs_plan/needs_human/is_risky Noul) for STATE. Call this BEFORE any other tool. Do NOT merge plan — call jev_plan separately next if needs_plan>=0.5 (once per task).",
    parameters: jevCalibrateSchema as unknown as Record<string, unknown>,
    async execute(_toolCallId: string, params: unknown) {
      const p = params as JevCalibrateParams;
      // once-per-task guard: calibration already done this task — separate calls, do not re-calibrate
      if (lastCalibrateTurn === turnId && lastPolicy) {
        return {
          content: [
            {
              type: "text",
              text: `blocked: jev_calibrate already called this task (turn ${turnId}) — proceed to jev_plan if needsPlan>=0.5, do not merge/re-call`,
            },
          ],
          details: {
            error: "already calibrated this task",
            code: "ALREADY_CALIBRATED",
            hint: "Calibration is once per task. Call jev_plan next if needed, do not re-call jev_calibrate.",
            retryable: false,
            nextAction: lastPolicy.needsPlan.p >= 0.5 ? "call jev_plan" : "proceed",
          },
        };
      }
      // reject merged payload if sent — enforce separation
      if ((p as unknown as { plan?: unknown }).plan) {
        return {
          content: [
            {
              type: "text",
              text: "blocked: merged calibrate+plan not allowed — call jev_calibrate (8 fields only) then jev_plan separately (once per task)",
            },
          ],
          details: {
            error: "merged not allowed",
            code: "MERGED_NOT_ALLOWED",
            hint: "Call jev_calibrate without plan, then call jev_plan separately.",
            retryable: true,
            nextAction: "call jev_calibrate without plan",
          },
        };
      }
      const latencyMs = Date.now() - t0;
      const policy = calibrateToPolicy(p, latencyMs);
      const risk = calibrateToRisk(p, config);
      lastPolicy = policy;
      lastRisk = { decision: risk };
      lastWasLowRisk = risk.pRisk < 0.4;
      lastCalibrateTurn = turnId;
      const cacheKey = `policy:${p.state.slice(0, 2000)}`;
      cache.set(cacheKey, policy);
      persistCache();
      const needsPlan = policy.needsPlan.p >= 0.5 && policy.complexity.level !== "low";
      if (needsPlan) {
        pendingPlanState = p.state;
        tPlan0 = Date.now();
      } else {
        pendingPlanState = null;
      }
      // telemetry — keep only needed
      lastTelemetry = {
        compressedChars: compressState(p.state).length,
        latencyMs,
        cached: false,
        trivialBypass: false,
      };
      append({
        type: "policy",
        policy,
        calibration: p,
        at: Date.now(),
        provider: process.env.PI_PROVIDER,
        model: process.env.PI_MODEL,
        telemetry: lastTelemetry,
      });
      const base = `calibrated via:pi-model complexity=${policy.complexity.level} score=${policy.complexity.score.toFixed(2)} urgent=${policy.isUrgent.p.toFixed(2)} needsPlan=${policy.needsPlan.p.toFixed(2)} risk=${risk.pRisk.toFixed(2)}`;
      const needsPlanNow = policy.needsPlan.p >= 0.5 && policy.complexity.level !== "low";
      const suffix = needsPlanNow
        ? "\n[JEV plan required next — call jev_plan for this STATE now (separate, once per task)]"
        : "";
      const nextAct = needsPlanNow ? "call jev_plan" : "proceed";
      return {
        content: [{ type: "text", text: base + suffix }],
        details: {
          policy,
          risk,
          needsPlan: policy.needsPlan.p >= 0.5,
          plan: null,
          nextAction: nextAct,
          telemetry: lastTelemetry,
          hint: needsPlanNow
            ? "Call jev_plan next (separate call, once per task)"
            : `Next: ${nextAct}`,
        },
      };
    },
  });

  (pi as any).registerTool({
    name: "jev_plan",
    label: "Jev Plan",
    description:
      "System-Two Jev plan: decompose STATE into 2-7 sequential steps with per-step risk/needsHuman. Call AFTER jev_calibrate when needs_plan>=0.5 (separate, once per task, never merged). Prefer smart_bundle for ≤8 files.",
    parameters: jevPlanSchema as unknown as Record<string, unknown>,
    async execute(_toolCallId: string, params: unknown) {
      const p = params as JevPlanParams;
      if (!lastPolicy)
        return {
          content: [
            {
              type: "text",
              text: "blocked: must call jev_calibrate before jev_plan (separate calls, once per task)",
            },
          ],
          details: {
            error: "calibrate first",
            code: "CALIBRATE_FIRST",
            hint: "Call jev_calibrate first (separate, once per task), then jev_plan",
            retryable: true,
            nextAction: "call jev_calibrate",
          },
        };
      if (lastPlanTurn === turnId && lastPlan) {
        return {
          content: [
            {
              type: "text",
              text: `blocked: jev_plan already called this task (turn ${turnId}) — once per task, proceed to execution`,
            },
          ],
          details: {
            error: "already planned this task",
            code: "ALREADY_PLANNED",
            hint: "Plan is once per task. Proceed with plan steps, do not re-call jev_plan.",
            retryable: false,
            nextAction: `run ${lastPlan.steps[lastPlan.cursor ?? 0]?.action ?? "read"}`,
          },
        };
      }
      const latencyMs = Date.now() - (tPlan0 || t0);
      const decision = planToDecision(p, latencyMs);
      lastPlan = decision;
      lastPlanTurn = turnId;
      pendingPlanState = null;
      cache.set(`plan:${p.state.slice(0, 2000)}`, decision);
      persistCache();
      append({
        type: "plan",
        plan: decision,
        params: p,
        at: Date.now(),
        provider: process.env.PI_PROVIDER,
        model: process.env.PI_MODEL,
      });
      const pretty = formatPlanDisplay(p, decision);
      const next = formatNextStep(decision);
      return {
        content: [{ type: "text", text: pretty + "\n" + next }],
        details: {
          plan: decision,
          nextAction: `run ${decision.steps[0]?.action ?? "read"}`,
          cursor: 0,
          hint: next,
        },
      };
    },
  });

  (pi as any).registerTool({
    name: "jev_git",
    label: "Jev Git",
    description:
      "Agent-friendly git for Jev harness — status/diff/log/commit/revert/init. Commit auto-generates conventional message from Jev calibration/plan if message omitted.",
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
        // advance cursor if commit was planned last step
        if (lastPlan && lastPlan.cursor < lastPlan.steps.length) {
          const lastStep = lastPlan.steps[lastPlan.steps.length - 1];
          if (lastStep.action === "write" || (lastPlan.steps[0] as any)) {
            lastPlan.cursor = lastPlan.steps.length;
          }
        }
      }
      append({
        type: "git",
        action: p.action,
        params: p,
        result: res.details,
        at: Date.now(),
      });
      return {
        content: [{ type: "text", text: res.text }],
        details: { ...res.details, nextAction: nextActionHint() },
      };
    },
  });

  // AF-05 wrappers for LLM precision (1 impl, N registrations)
  const gitWrappers: Array<{
    name: string;
    action: JevGitParams["action"];
    label: string;
    desc: string;
  }> = [
    {
      name: "jev_git_status",
      action: "status",
      label: "Jev Git Status",
      desc: "Git status — coalesced single exec, branch+porcelain",
    },
    {
      name: "jev_git_commit",
      action: "commit",
      label: "Jev Git Commit",
      desc: "Git commit — auto message from Jev policy/plan if message omitted",
    },
    { name: "jev_git_diff", action: "diff", label: "Jev Git Diff", desc: "Git diff --stat + diff" },
    { name: "jev_git_log", action: "log", label: "Jev Git Log", desc: "Git log oneline" },
  ];
  for (const w of gitWrappers) {
    (pi as any).registerTool({
      name: w.name,
      label: w.label,
      description: w.desc,
      parameters: {
        type: "object",
        properties:
          w.action === "commit"
            ? { message: { type: "string" }, files: { type: "array", items: { type: "string" } } }
            : w.action === "log"
              ? { limit: { type: "number" } }
              : {},
        required: [],
      } as unknown as Record<string, unknown>,
      async execute(_id: string, params: unknown) {
        const p = { action: w.action, ...(params as object) } as JevGitParams;
        const res = await handleJevGit(pi as unknown as any, p, {
          policy: lastPolicy,
          plan: lastPlan,
          state: pendingPlanState ?? pendingState,
        });
        return {
          content: [{ type: "text", text: res.text }],
          details: { ...res.details, nextAction: nextActionHint() },
        };
      },
    });
  }

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
          persistCache();
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

  // ── commands ───────────────────────────────────────────────────────────
  pi.registerCommand("jev:status", {
    description: "Show last pi-model Jev calibration + plan + git — card view (add --json for raw)",
    handler: async (a: string, ctx: unknown) => {
      if (a.trim() === "--json") {
        (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
          JSON.stringify(
            {
              policy: lastPolicy,
              risk: lastRisk,
              plan: lastPlan,
              git: lastGit,
              telemetry: lastTelemetry,
              phase: phaseOf({
                policy: lastPolicy,
                risk: lastRisk,
                plan: lastPlan,
                pendingState,
                pendingPlanState,
              }),
            },
            null,
            2,
          ),
          "info",
        );
        return;
      }
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(cardStatus(), "info");
    },
  });
  pi.registerCommand("jev:plan", {
    description: "Show last Jev plan",
    handler: async (_a: string, ctx: unknown) => {
      if (!lastPlan) {
        (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
          "No Jev plan yet — trigger a task with needs_plan>=0.5 then call jev_plan separately (once per task)",
          "info",
        );
        return;
      }
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
        formatPlanNotify(lastPlan) + "\n" + formatNextStep(lastPlan),
        "info",
      );
    },
  });
  pi.registerCommand("jev:next", {
    description: "Show next plan step + hint",
    handler: async (_a: string, ctx: unknown) => {
      if (!lastPlan) {
        (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
          "No plan — /jev:status to check phase",
          "info",
        );
        return;
      }
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
        formatNextStep(lastPlan),
        "info",
      );
    },
  });
  pi.registerCommand("jev:help", {
    description: "Jev harness help (all commands & tools)",
    handler: async (_a: string, ctx: unknown) => {
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
        `Jev harness — pi-model tool-based, no fallback\n` +
          `  Calibrates risk per task (5 Questions), plans high-complexity work, gates risky edits, auto-commits.\n` +
          `  Tools: jev_calibrate, jev_plan (separate, once per task), jev_git (+wrappers: status/diff/log/commit)\n` +
          `  Commands: /jev:status [--json], /jev:plan, /jev:next, /jev:help, /jev:cost, /jev:config [risk|urgent], /jev:resume, /jev:git [status|diff|log|commit], /jev:log [n], /jev:commit [msg], /jev:clear [--confirm|--restore]\n` +
          `  Tips: trivial prompts bypass calibrate (save ~450 tok); prefer smart_bundle for ≤8 files; /jev:status shows card, /jev:cost shows telemetry.\n` +
          `  Docs: docs/DESIGN.md · README.md\n` +
          `  Aliases: /jev:log ≡ /jev:git log, /jev:commit ≡ /jev:git commit`,
        "info",
      );
    },
  });
  pi.registerCommand("jev:cost", {
    description: "Show Jev token/latency telemetry",
    handler: async (_a: string, ctx: unknown) => {
      const st = cache.getStats();
      const tel = lastTelemetry
        ? `last: ${lastTelemetry.compressedChars}ch · ${lastTelemetry.latencyMs}ms · cached=${lastTelemetry.cached}${lastTelemetry.trivialBypass ? " · bypass" : ""}`
        : "no telemetry yet";
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
        `Jev cost\n  ${tel}\n  cache: ${st.size} entries · hitRate ${(st.hitRate * 100).toFixed(0)}%  ·  thresholds risk ${config.thresholds.risk} urgent ${config.thresholds.urgent}`,
        "info",
      );
    },
  });
  pi.registerCommand("jev:config", {
    description: "Tune thresholds live (usage: /jev:config risk 0.80 urgent 0.85)",
    handler: async (args: string, ctx: unknown) => {
      if (!args.trim()) {
        (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
          `Jev config\n  risk ${config.thresholds.risk} · urgent ${config.thresholds.urgent} · complexity ${config.thresholds.complexity} · ttl ${config.cacheTtlMs}ms\n  Usage: /jev:config risk 0.80 urgent 0.85`,
          "info",
        );
        return;
      }
      const parsed = parseThresholdArgs(args);
      if (!parsed) {
        (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
          `No valid thresholds parsed. Use: /jev:config risk 0.80`,
          "info",
        );
        return;
      }
      if (parsed.risk !== undefined) config.thresholds.risk = parsed.risk;
      if (parsed.urgent !== undefined) config.thresholds.urgent = parsed.urgent;
      if ((parsed as Record<string, number>).complexity !== undefined)
        config.thresholds.complexity = (parsed as Record<string, number>).complexity;
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
        `Jev thresholds updated → risk ${config.thresholds.risk} urgent ${config.thresholds.urgent}`,
        "info",
      );
    },
  });
  pi.registerCommand("jev:resume", {
    description: "Resume last plan cursor",
    handler: async (_a: string, ctx: unknown) => {
      if (!lastPlan) {
        (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
          "No plan to resume",
          "info",
        );
        return;
      }
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
        `Resuming ${lastPlan.steps.length} steps — ` + formatNextStep(lastPlan),
        "info",
      );
    },
  });
  pi.registerCommand("jev:git", {
    description:
      "Jev git — status/diff/log/commit/revert/init (usage: /jev:git status | diff | log 12 | commit | revert <hash> | init)",
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
    description: "Show git log (alias — prefer /jev:git log) — via jev_git",
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
    description: "Commit via jev_git (alias — prefer /jev:git commit) (usage: /jev:commit [msg])",
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
