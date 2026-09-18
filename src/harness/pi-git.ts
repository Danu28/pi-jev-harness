/**
 * PI-Harness Git helper — agent-friendly jev_git tool + auto-commit.
 * via:git (deterministic) but audited via pi-model harness. Zero deps.
 * Uses pi.exec("git", args) when available, falls back to node:child_process.
 * Commit message arg is argv-safe (no shell).
 */
import type { Via, PolicyDecision } from "../types.ts";
import type { PlanDecision } from "./pi-planner.ts";

export const jevGitSchema = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["status", "diff", "log", "commit", "revert", "init"],
      description: "Git action",
    },
    message: {
      type: "string",
      description:
        "Commit message (required for commit, conventional if empty auto-generated from Jev calibration/plan)",
    },
    files: {
      type: "array",
      items: { type: "string" },
      description: "Files to add for commit (default: all changes)",
    },
    hash: { type: "string", description: "Commit hash for revert" },
    limit: { type: "number", minimum: 1, maximum: 50, description: "Log limit (default 12)" },
  },
  required: ["action"],
} as const;

export type JevGitParams = {
  action: "status" | "diff" | "log" | "commit" | "revert" | "init";
  message?: string;
  files?: string[];
  hash?: string;
  limit?: number;
};

export interface PiExecLike {
  exec?(cmd: string, args: string[]): Promise<{ code?: number; stdout?: string; stderr?: string }>;
}

// ── helpers ────────────────────────────────────────────────────────────────
async function execGit(
  pi: PiExecLike,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    if (typeof pi?.exec === "function") {
      const r = await pi.exec("git", args);
      return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    }
  } catch {}
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { code: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? String(r.error ?? "") };
}

export function buildCommitMessage(
  state: string,
  policy: PolicyDecision | null,
  plan: PlanDecision | null,
  explicit?: string,
): string {
  if (explicit?.trim()) return explicit.trim();
  const title = state.slice(0, 72).replace(/\s+/g, " ").replace(/\n/g, " ").trim() || "update";
  const prefix =
    policy?.complexity?.level === "high"
      ? "feat"
      : policy?.complexity?.level === "medium"
        ? "feat"
        : "chore";
  const first = `${prefix}(jev): ${title}`.slice(0, 72);
  const body: string[] = [];
  if (policy)
    body.push(
      `complexity=${policy.complexity.level} score=${policy.complexity.score.toFixed(2)} needsPlan=${policy.needsPlan.p.toFixed(2)}`,
    );
  if (plan) body.push(`plan: ${plan.steps.length} steps maxRisk=${plan.maxRisk.toFixed(2)}`);
  body.push("via:pi-model");
  if (plan?.reasoning) body.push(plan.reasoning);
  return body.length ? `${first}\n\n${body.join(" · ")}` : first;
}

async function ensureGitConfig(pi: PiExecLike): Promise<void> {
  const { stdout: name } = await execGit(pi, ["config", "--get", "user.name"]);
  if (!name.trim()) await execGit(pi, ["config", "user.name", "jev-agent"]);
  const { stdout: email } = await execGit(pi, ["config", "--get", "user.email"]);
  if (!email.trim()) await execGit(pi, ["config", "user.email", "jev@pi.local"]);
}

// ── formatters (UI-friendly) ────────────────────────────────────────────
function divider(n = 52): string {
  return "\u2500".repeat(n);
}

export function formatStatus(branch: string, porcelain: string): string {
  const noEmoji = process.env.PI_NO_EMOJI === "1" || process.env.NO_EMOJI === "1";
  const tree = noEmoji ? "[status]" : "\uD83C\uDF3F";
  const ok = noEmoji ? "[ok]" : "\u2705";
  if (!porcelain.trim())
    return `${tree} Git Status  \u00B7  ${branch || "main"}\n${divider()}\n${ok} clean \u2014 no changes to commit`;
  const raw = porcelain.split("\n").filter((l) => l.length > 0);
  const lines = raw.map((l) => l.replace(/\r$/, ""));
  const pretty = lines.map((l) => {
    const code = l.slice(0, 2);
    const file = l.slice(3);
    const icon = noEmoji
      ? ` ${code.trim() || "??"}`
      : code.includes("M")
        ? "\u270F\uFE0F"
        : code.includes("A")
          ? "\u2795"
          : code.includes("D")
            ? "\uD83D\uDDD1\uFE0F"
            : code.includes("??")
              ? "\u2753"
              : "\u2022";
    return `  ${icon} ${code} ${file}`;
  });
  return `${tree} Git Status  \u00B7  ${branch || "detached"}  \u00B7  ${lines.length} changed\n${divider()}\n${pretty.join("\n")}`;
}

export function formatLog(stdout: string): string {
  const noEmoji = process.env.PI_NO_EMOJI === "1";
  const hdr = noEmoji ? "[log] Git Log" : "\uD83D\uDCCB Git Log";
  if (!stdout.trim()) return `${hdr}\n${divider()}\n(no commits yet)`;
  const lines = stdout.trim().split("\n");
  const pretty = lines.map((l) => {
    const m = l.match(/^(\S+)\s+(.*)$/);
    if (!m) return `  \u2022 ${l}`;
    return `  \u25CF ${m[1].slice(0, 7)}  ${m[2]}`;
  });
  return `${hdr}  \u00B7  ${lines.length} commits\n${divider(44)}\n${pretty.join("\n")}`;
}

export function formatDiff(stat: string, diff: string): string {
  const noEmoji = process.env.PI_NO_EMOJI === "1";
  const hdr = noEmoji ? "[diff] Git Diff" : "\uD83D\uDD0D Git Diff";
  const s = stat.trim() ? stat.trim() : "(no stat)";
  const d = diff.trim()
    ? diff.slice(0, 4000) + (diff.length > 4000 ? "\n\u2026truncated" : "")
    : "(no diff)";
  return `${hdr}\n${divider()}\n${s}\n\n${d}`;
}

export function formatCommit(hash: string, msg: string, files: string): string {
  const noEmoji = process.env.PI_NO_EMOJI === "1";
  const ok = noEmoji ? "[ok]" : "\u2705";
  const pkg = noEmoji ? "[files]" : "\uD83D\uDCE6";
  const short = hash.slice(0, 7) || "new";
  const fileLine = files.trim() ? files.trim().split("\n").slice(0, 10).join(", ") : "all";
  return `${ok} Committed  \u00B7  ${short}  \u00B7  ${msg.split("\n")[0]}\n${divider()}\n${msg}\n\n${pkg} ${fileLine}`;
}

// Coalesced status parser for CE-02: single exec "git status --porcelain --branch" gives branch in "## " header
function parsePorcelainBranch(raw: string): { branch: string; porcelain: string } {
  const lines = raw.split("\n");
  let branch = "";
  const por: string[] = [];
  for (const l of lines) {
    if (l.startsWith("## ")) {
      // "## main...origin/main" or "## No commits yet on main"
      const m = l.match(/##\s+(?:No commits yet on\s+)?(\S+)/);
      if (m) branch = m[1].split(".")[0];
      continue;
    }
    if (l.trim() === "") continue;
    por.push(l);
  }
  return { branch, porcelain: por.join("\n") };
}

// ── main handler ─────────────────────────────────────────────────────────
export async function handleJevGit(
  pi: PiExecLike,
  params: JevGitParams,
  ctx: { policy: PolicyDecision | null; plan: PlanDecision | null; state: string | null },
): Promise<{ text: string; details: Record<string, unknown> }> {
  const action = params.action;

  if (action === "init") {
    const { code, stderr } = await execGit(pi, ["init"]);
    if (code !== 0)
      return { text: `\u274C git init failed: ${stderr}`, details: { error: stderr } };
    await ensureGitConfig(pi);
    return {
      text: `\uD83C\uDF31 Git initialized  \u00B7  via git\n${divider()}\nready to commit`,
      details: { action: "init" },
    };
  }

  let { code: rev } = await execGit(pi, ["rev-parse", "--is-inside-work-tree"]);
  if (rev !== 0) {
    if (action === "commit") {
      const { code: initCode, stderr: initErr } = await execGit(pi, ["init"]);
      if (initCode !== 0)
        return {
          text: `\u274C Not a git repo and auto-init failed: ${initErr}`,
          details: { error: initErr },
        };
      await ensureGitConfig(pi);
      rev = 0;
    } else {
      return {
        text: `\u274C Not a git repo \u2014 run jev_git action=init first (or commit will auto-init)`,
        details: { error: "not a git repo" },
      };
    }
  }

  if (action === "status") {
    // CE-02: coalesce to single exec; fallback to old two-exec if --branch fails
    const { code, stdout } = await execGit(pi, ["status", "--porcelain", "--branch"]);
    if (code === 0 && stdout.includes("##")) {
      const parsed = parsePorcelainBranch(stdout);
      return {
        text: formatStatus(parsed.branch, parsed.porcelain),
        details: { branch: parsed.branch, porcelain: parsed.porcelain },
      };
    }
    // fallback (legacy git)
    const [{ stdout: branchRaw }, { stdout: por }] = await Promise.all([
      execGit(pi, ["branch", "--show-current"]),
      execGit(pi, ["status", "--porcelain"]),
    ]);
    const branch =
      branchRaw.trim() || (await execGit(pi, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
    return { text: formatStatus(branch, por), details: { branch, porcelain: por } };
  }

  if (action === "log") {
    const n = String(params.limit ?? 12);
    const { stdout, stderr, code } = await execGit(pi, [
      "log",
      `--max-count=${n}`,
      "--oneline",
      "--no-color",
    ]);
    if (code !== 0)
      return { text: `\u274C git log failed: ${stderr || stdout}`, details: { error: stderr } };
    return { text: formatLog(stdout), details: { log: stdout } };
  }

  if (action === "diff") {
    const [{ stdout: stat }, { stdout: diff }] = await Promise.all([
      execGit(pi, ["diff", "--stat"]),
      execGit(pi, ["diff"]),
    ]);
    const { stdout: staged } = await execGit(pi, ["diff", "--cached", "--stat"]);
    const extra = staged.trim() ? `\n\n\u2014 staged \u2014\n${staged}` : "";
    return { text: formatDiff(stat + extra, diff) || "no changes", details: { stat, diff } };
  }

  if (action === "revert") {
    if (!params.hash)
      return {
        text: `\u274C revert needs hash \u2014 jev_git action=revert hash=abc1234`,
        details: { error: "hash required" },
      };
    const { code, stdout, stderr } = await execGit(pi, ["revert", "--no-edit", params.hash]);
    if (code !== 0)
      return {
        text: `\u274C revert failed: ${stderr || stdout}`,
        details: { error: stderr || stdout },
      };
    return {
      text: `\u21A9\uFE0F Reverted ${params.hash.slice(0, 7)}\n${divider()}\n${stdout.slice(0, 1000)}`,
      details: { reverted: params.hash },
    };
  }

  if (action === "commit") {
    const { stdout: por, code: sCode } = await execGit(pi, ["status", "--porcelain"]);
    if (sCode !== 0) return { text: `\u274C git status failed`, details: { error: por } };
    if (!por.trim())
      return {
        text: `\u2705 Nothing to commit \u2014 working tree clean`,
        details: { clean: true },
      };
    await ensureGitConfig(pi);
    const msg = buildCommitMessage(ctx.state ?? "update", ctx.policy, ctx.plan, params.message);
    const files = params.files?.length ? params.files : [];
    if (files.length) await execGit(pi, ["add", "--", ...files]);
    else await execGit(pi, ["add", "-A"]);
    const { code, stdout, stderr } = await execGit(pi, ["commit", "-m", msg]);
    if (code !== 0)
      return {
        text: `\u274C commit failed: ${stderr || stdout}`,
        details: { error: stderr || stdout },
      };
    const { stdout: hash } = await execGit(pi, ["rev-parse", "HEAD"]);
    const { stdout: filesOut } = await execGit(pi, [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "HEAD",
    ]);
    return {
      text: formatCommit(hash.trim(), msg, filesOut),
      details: { action: "commit", hash: hash.trim(), message: msg, via: "git" as Via },
    };
  }

  return { text: `\u274C unknown action ${action}`, details: { error: "unknown" } };
}

export async function autoCommitIfDirty(
  pi: PiExecLike,
  ctx: { policy: PolicyDecision | null; plan: PlanDecision | null; state: string | null },
): Promise<{ committed: boolean; text?: string; hash?: string }> {
  let { code: rev } = await execGit(pi, ["rev-parse", "--is-inside-work-tree"]);
  if (rev !== 0) {
    try {
      await execGit(pi, ["init"]);
    } catch {}
    const after = await execGit(pi, ["rev-parse", "--is-inside-work-tree"]);
    if (after.code !== 0) return { committed: false };
    await ensureGitConfig(pi);
  }
  const { stdout: por } = await execGit(pi, ["status", "--porcelain"]);
  if (!por.trim()) return { committed: false };
  // PR-06: only auto-commit if plan done or high complexity; otherwise skip noisy micro-commits
  const shouldCommit = (() => {
    if (!ctx.plan) return ctx.policy?.complexity.level === "high";
    // commit when cursor reached end (task done) or no cursor (legacy plan)
    if (ctx.plan.cursor !== undefined) return ctx.plan.cursor >= ctx.plan.steps.length;
    return true;
  })();
  if (!shouldCommit) return { committed: false };
  await ensureGitConfig(pi);
  const msg = buildCommitMessage(ctx.state ?? "auto: pi agent work", ctx.policy, ctx.plan);
  await execGit(pi, ["add", "-A"]);
  const { code, stdout, stderr } = await execGit(pi, ["commit", "-m", msg]);
  if (code !== 0) return { committed: false, text: stderr || stdout };
  const { stdout: hash } = await execGit(pi, ["rev-parse", "HEAD"]);
  return { committed: true, hash: hash.trim(), text: formatCommit(hash.trim(), msg, por) };
}
