/** Command handlers extracted from index.ts — pure factories over state getters */
import { phaseOf } from "../harness/gate.ts";
import { formatNextStep, formatPlanNotify } from "../harness/pi-planner.ts";
import { handleJevGit } from "../harness/pi-git.ts";
import { parseThresholdArgs } from "../harness/config.ts";
import type { JevCache } from "../harness/cache.ts";
import type { HarnessConfig } from "../types.ts";
import type { UiState } from "./ui.ts";

export type StateGetter = () => UiState & {
  config: HarnessConfig;
  cache: JevCache;
  clearBackup: { policy: unknown; plan: unknown; at: number } | null;
};

// Each factory returns a handler compatible with pi.registerCommand
export function statusHandler(get: StateGetter, card: () => string) {
  return async (a: string, ctx: unknown) => {
    if (a.trim() === "--json") {
      const s = get();
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
        JSON.stringify(
          {
            policy: s.policy,
            risk: s.risk,
            plan: s.plan,
            git: s.git,
            telemetry: s.telemetry,
            phase: phaseOf({
              policy: s.policy,
              risk: s.risk,
              plan: s.plan,
              pendingState: s.pendingState,
              pendingPlanState: s.pendingPlanState,
            }),
          },
          null,
          2,
        ),
        "info",
      );
      return;
    }
    (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(card(), "info");
  };
}

export function planHandler(get: StateGetter) {
  return async (_a: string, ctx: unknown) => {
    const s = get();
    if (!s.plan) {
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
        "No Jev plan yet — trigger a task with needs_plan>=0.5 then call jev_plan separately (once per task)",
        "info",
      );
      return;
    }
    (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
      formatPlanNotify(s.plan) + "\n" + formatNextStep(s.plan),
      "info",
    );
  };
}

export function nextHandler(get: StateGetter) {
  return async (_a: string, ctx: unknown) => {
    const s = get();
    if (!s.plan) {
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify("No plan — /jev:status to check phase", "info");
      return;
    }
    (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(formatNextStep(s.plan), "info");
  };
}

export function helpHandler() {
  return async (_a: string, ctx: unknown) => {
    (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
      `Jev harness — pi-model tool-based, no fallback\n` +
        `  Calibrates risk per task (5 Questions), plans high-complexity work, gates risky edits, auto-commits.\n` +
        `  Tools: jev_calibrate, jev_plan (separate, once per task), jev_git (action: status|diff|log|commit|revert|init)\n` +
        `  Commands: /jev:status [--json], /jev:plan, /jev:next, /jev:help, /jev:cost, /jev:config [risk|urgent], /jev:resume, /jev:git [status|diff|log|commit], /jev:clear [--confirm|--restore]\n` +
        `  Tips: trivial prompts bypass calibrate (save ~450 tok); prefer smart_bundle for ≤8 files; /jev:status shows card, /jev:cost shows telemetry.\n` +
        `  Docs: docs/DESIGN.md · README.md`,
      "info",
    );
  };
}

export function costHandler(get: StateGetter) {
  return async (_a: string, ctx: unknown) => {
    const s = get();
    const st = s.cache.getStats();
    const tel = s.telemetry
      ? `last: ${s.telemetry.compressedChars}ch · ${s.telemetry.latencyMs}ms · cached=${s.telemetry.cached}${s.telemetry.trivialBypass ? " · bypass" : ""}`
      : "no telemetry yet";
    (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
      `Jev cost\n  ${tel}\n  cache: ${st.size} entries · hitRate ${(st.hitRate * 100).toFixed(0)}%  ·  thresholds risk ${s.config.thresholds.risk} urgent ${s.config.thresholds.urgent}`,
      "info",
    );
  };
}

export function configHandler(get: StateGetter) {
  return async (args: string, ctx: unknown) => {
    const s = get();
    if (!args.trim()) {
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
        `Jev config\n  risk ${s.config.thresholds.risk} · urgent ${s.config.thresholds.urgent} · complexity ${s.config.thresholds.complexity} · ttl ${s.config.cacheTtlMs}ms\n  Usage: /jev:config risk 0.80 urgent 0.85`,
        "info",
      );
      return;
    }
    const parsed = parseThresholdArgs(args);
    if (!parsed) {
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(`No valid thresholds parsed. Use: /jev:config risk 0.80`, "info");
      return;
    }
    if (parsed.risk !== undefined) s.config.thresholds.risk = parsed.risk;
    if (parsed.urgent !== undefined) s.config.thresholds.urgent = parsed.urgent;
    if ((parsed as Record<string, number>).complexity !== undefined) s.config.thresholds.complexity = (parsed as Record<string, number>).complexity;
    (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(`Jev thresholds updated → risk ${s.config.thresholds.risk} urgent ${s.config.thresholds.urgent}`, "info");
  };
}

export function gitHandler(pi: unknown, get: StateGetter) {
  return async (args: string, ctx: unknown) => {
    const s = get();
    const a = (args.trim().split(/\s+/)[0] || "status") as import("../harness/pi-git.ts").JevGitParams["action"];
    const lim = parseInt(args.trim().split(/\s+/)[1] || "12", 10);
    const res = await handleJevGit(
      pi as unknown as { exec?: (cmd: string, args: string[]) => Promise<{ code?: number; stdout?: string; stderr?: string }> },
      { action: a as never, limit: isNaN(lim) ? 12 : lim } as import("../harness/pi-git.ts").JevGitParams,
      { policy: s.policy, plan: s.plan, state: s.pendingPlanState ?? s.pendingState },
    );
    (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(res.text, "info");
  };
}

export function clearHandler(get: StateGetter, doClear: () => void, doRestore: () => boolean) {
  return async (a: string, ctx: unknown) => {
    const args = a.trim();
    const s = get();
    if (args === "--restore" || args === "restore") {
      if (!s.clearBackup) {
        (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify("No backup to restore", "info");
        return;
      }
      const ok = doRestore();
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(ok ? "Jev cache restored from backup" : "No backup to restore", "info");
      return;
    }
    if (args !== "--confirm") {
      (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(`Jev clear — this will clear policy/plan/cache. Run /jev:clear --confirm to proceed. Backup will be kept for /jev:clear --restore.`, "info");
      return;
    }
    doClear();
    (ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify("Jev cache cleared — next turn will recalibrate via pi-model (backup kept: /jev:clear --restore)", "info");
  };
}
