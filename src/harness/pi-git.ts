/**
 * PI-Harness Git helper — agent-friendly jev_git tool + auto-commit.
 * via:git (deterministic) but audited via pi-model harness. Zero deps.
 * Uses pi.exec("git", args) when available, falls back to node:child_process.
 */
import type { Via } from "../types.ts";

export const jevGitSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["status", "diff", "log", "commit", "revert", "init"], description: "Git action" },
    message: { type: "string", description: "Commit message (required for commit, conventional if empty auto-generated from Jev calibration/plan)" },
    files: { type: "array", items: { type: "string" }, description: "Files to add for commit (default: all changes)" },
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

// ── helpers ────────────────────────────────────────────────────────────────
async function execGit(pi: any, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    if (typeof pi?.exec === "function") {
      const r = await pi.exec("git", args);
      return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    }
  } catch (_) {}
  // fallback node
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { code: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? String(r.error ?? "") };
}

export function buildCommitMessage(state: string, policy: any, plan: any, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  const title = state.slice(0, 72).replace(/\s+/g, " ").replace(/\n/g, " ").trim() || "update";
  const prefix = policy?.complexity?.level === "high" ? "feat" : policy?.complexity?.level === "medium" ? "feat" : "chore";
  const first = `${prefix}(jev): ${title}`.slice(0, 72);
  const body: string[] = [];
  if (policy) body.push(`complexity=${policy.complexity.level} score=${policy.complexity.score.toFixed(2)} needsPlan=${policy.needsPlan.p.toFixed(2)}`);
  if (plan) body.push(`plan: ${plan.steps.length} steps maxRisk=${plan.maxRisk.toFixed(2)}`);
  body.push("via:pi-model");
  if (plan?.reasoning) body.push(plan.reasoning);
  return body.length ? `${first}\n\n${body.join(" · ")}` : first;
}

async function ensureGitConfig(pi: any): Promise<void> {
  const { stdout: name } = await execGit(pi, ["config", "--get", "user.name"]);
  if (!name.trim()) await execGit(pi, ["config", "user.name", "jev-agent"]);
  const { stdout: email } = await execGit(pi, ["config", "--get", "user.email"]);
  if (!email.trim()) await execGit(pi, ["config", "user.email", "jev@pi.local"]);
}

// ── formatters (UI-friendly) ────────────────────────────────────────────
function divider(n = 52): string { return "─".repeat(n); }

export function formatStatus(branch: string, porcelain: string): string {
  if (!porcelain.trim()) return `🌿 Git Status  ·  ${branch || "main"}\n${divider()}\n✅ clean — no changes to commit`;
  const lines = porcelain.trim().split("\n");
  const pretty = lines.map((l) => {
    const code = l.slice(0, 2);
    const file = l.slice(3);
    const icon = code.includes("M") ? "✏️" : code.includes("A") ? "➕" : code.includes("D") ? "🗑️" : code.includes("??") ? "❓" : "•";
    return `  ${icon} ${code} ${file}`;
  });
  return `🌿 Git Status  ·  ${branch || "detached"}  ·  ${lines.length} changed\n${divider()}\n${pretty.join("\n")}`;
}

export function formatLog(stdout: string): string {
  if (!stdout.trim()) return `📜 Git Log\n${divider()}\n(no commits yet)`;
  const lines = stdout.trim().split("\n");
  const pretty = lines.map((l) => {
    const m = l.match(/^(\S+)\s+(.*)$/);
    if (!m) return `  • ${l}`;
    return `  ● ${m[1].slice(0, 7)}  ${m[2]}`;
  });
  return `📜 Git Log  ·  ${lines.length} commits\n${divider(44)}\n${pretty.join("\n")}`;
}

export function formatDiff(stat: string, diff: string): string {
  const s = stat.trim() ? stat.trim() : "(no stat)";
  const d = diff.trim() ? diff.slice(0, 4000) + (diff.length > 4000 ? "\n…truncated" : "") : "(no diff)";
  return `🔍 Git Diff\n${divider()}\n${s}\n\n${d}`;
}

export function formatCommit(hash: string, msg: string, files: string): string {
  const short = hash.slice(0, 7) || "new";
  const fileLine = files.trim() ? files.trim().split("\n").slice(0, 10).join(", ") : "all";
  return `✅ Committed  ·  ${short}  ·  ${msg.split("\n")[0]}\n${divider()}\n${msg}\n\n📦 ${fileLine}`;
}

// ── main handler ─────────────────────────────────────────────────────────
export async function handleJevGit(pi: any, params: JevGitParams, ctx: { policy: any; plan: any; state: string | null }): Promise<{ text: string; details: any }> {
  const action = params.action;

  // init
  if (action === "init") {
    const { code, stderr } = await execGit(pi, ["init"]);
    if (code !== 0) return { text: `❌ git init failed: ${stderr}`, details: { error: stderr } };
    await ensureGitConfig(pi);
    return { text: `🌱 Git initialized  ·  via git\n${divider()}\nready to commit`, details: { action: "init" } };
  }

  // check repo — for commit auto-init if needed (agent-friendly), for others just report
  let { code: rev } = await execGit(pi, ["rev-parse", "--is-inside-work-tree"]);
  if (rev !== 0) {
    if (action === "commit") {
      // agent-friendly: auto-init then continue
      const { code: initCode, stderr: initErr } = await execGit(pi, ["init"]);
      if (initCode !== 0) return { text: `❌ Not a git repo and auto-init failed: ${initErr}`, details: { error: initErr } };
      await ensureGitConfig(pi);
      // create initial .gitignore for artifacts if needed
      rev = 0;
    } else {
      return { text: `❌ Not a git repo — run jev_git action=init first (or commit will auto-init)`, details: { error: "not a git repo" } };
    }
  }

  if (action === "status") {
    const [{ stdout: branchRaw }, { stdout: por }] = await Promise.all([execGit(pi, ["branch", "--show-current"]), execGit(pi, ["status", "--porcelain"]) ]);
    const branch = branchRaw.trim() || (await execGit(pi, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
    return { text: formatStatus(branch, por), details: { branch, porcelain: por } };
  }

  if (action === "log") {
    const n = String(params.limit ?? 12);
    const { stdout, stderr, code } = await execGit(pi, ["log", `--max-count=${n}`, "--oneline", "--no-color"]);
    if (code !== 0) return { text: `❌ git log failed: ${stderr || stdout}`, details: { error: stderr } };
    return { text: formatLog(stdout), details: { log: stdout } };
  }

  if (action === "diff") {
    const [{ stdout: stat }, { stdout: diff }] = await Promise.all([execGit(pi, ["diff", "--stat"]), execGit(pi, ["diff"])]);
    const { stdout: staged } = await execGit(pi, ["diff", "--cached", "--stat"]);
    const extra = staged.trim() ? `\n\n— staged —\n${staged}` : "";
    return { text: formatDiff(stat + extra, diff) || "no changes", details: { stat, diff } };
  }

  if (action === "revert") {
    if (!params.hash) return { text: `❌ revert needs hash — jev_git action=revert hash=abc1234`, details: { error: "hash required" } };
    const { code, stdout, stderr } = await execGit(pi, ["revert", "--no-edit", params.hash]);
    if (code !== 0) return { text: `❌ revert failed: ${stderr || stdout}`, details: { error: stderr || stdout } };
    return { text: `↩️ Reverted ${params.hash.slice(0, 7)}\n${divider()}\n${stdout.slice(0, 1000)}`, details: { reverted: params.hash } };
  }

  if (action === "commit") {
    const { stdout: por, code: sCode } = await execGit(pi, ["status", "--porcelain"]);
    if (sCode !== 0) return { text: `❌ git status failed`, details: { error: por } };
    if (!por.trim()) return { text: `✅ Nothing to commit — working tree clean`, details: { clean: true } };
    await ensureGitConfig(pi);
    const msg = buildCommitMessage(ctx.state ?? "update", ctx.policy, ctx.plan, params.message);
    const files = params.files?.length ? params.files : [];
    if (files.length) await execGit(pi, ["add", "--", ...files]);
    else await execGit(pi, ["add", "-A"]);
    const { code, stdout, stderr } = await execGit(pi, ["commit", "-m", msg]);
    if (code !== 0) return { text: `❌ commit failed: ${stderr || stdout}`, details: { error: stderr || stdout } };
    const { stdout: hash } = await execGit(pi, ["rev-parse", "HEAD"]);
    const { stdout: filesOut } = await execGit(pi, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]);
    return { text: formatCommit(hash.trim(), msg, filesOut), details: { action: "commit", hash: hash.trim(), message: msg, via: "git" as Via } };
  }

  return { text: `❌ unknown action ${action}`, details: { error: "unknown" } };
}

export async function autoCommitIfDirty(pi: any, ctx: { policy: any; plan: any; state: string | null }): Promise<{ committed: boolean; text?: string; hash?: string }> {
  let { code: rev } = await execGit(pi, ["rev-parse", "--is-inside-work-tree"]);
  if (rev !== 0) {
    // auto-init for dirty working dir (agent-friendly) — only if files exist
    const { spawnSync } = await import("node:child_process");
    const ls = spawnSync("git", ["init"], { encoding: "utf8" });
    // use pi.exec if available for cwd correctness
    try { await execGit(pi, ["init"]); } catch {}
    const after = await execGit(pi, ["rev-parse", "--is-inside-work-tree"]);
    if (after.code !== 0) return { committed: false };
    await ensureGitConfig(pi);
  }
  const { stdout: por } = await execGit(pi, ["status", "--porcelain"]);
  if (!por.trim()) return { committed: false };
  await ensureGitConfig(pi);
  const msg = buildCommitMessage(ctx.state ?? "auto: pi agent work", ctx.policy, ctx.plan);
  await execGit(pi, ["add", "-A"]);
  const { code, stdout, stderr } = await execGit(pi, ["commit", "-m", msg]);
  if (code !== 0) return { committed: false, text: stderr || stdout };
  const { stdout: hash } = await execGit(pi, ["rev-parse", "HEAD"]);
  return { committed: true, hash: hash.trim(), text: formatCommit(hash.trim(), msg, por) };
}
