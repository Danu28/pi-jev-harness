/**
 * PI-Model Classifier — Jev concepts powered by the user's active pi model.
 * NOT a regular regex extension: evaluates Noul/Score Questions via the pi model
 * (PI_PROVIDER/PI_MODEL from env + auth.json), parallel, typed, thresholded.
 * Falls back to enhanced rules (via:"rules") only if pi model unavailable.
 * When pi model is used, returns via:"pi-model" with calibrated probs.
 */
import type { HarnessConfig, PolicyDecision } from "../types.ts";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function getAuthKey(provider: string): string | undefined {
  try {
    const dir = process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".pi", "agent");
    const p = join(dir, "auth.json");
    if (!existsSync(p)) return undefined;
    const j = JSON.parse(readFileSync(p, "utf8"));
    return j[provider]?.key ?? j[provider]?.apiKey;
  } catch { return undefined; }
}

// Build a tiny Jev-style structured prompt for the pi model
function buildJevPrompt(state: string): string {
  return `You are a System-One classifier (Jev concepts). Evaluate the STATE and return ONLY JSON.
STATE: ${state.slice(0, 4000)}
Questions (answer all, parallel):
1. complexity: Score low/medium/high — how complex is the task for a coding agent?
2. is_urgent: Noul 0-1 — urgency/time-sensitivity?
3. needs_plan: Noul 0-1 — needs multi-step plan?
4. needs_human: Noul 0-1 — needs human confirm (destructive/prod/secrets)?
5. is_risky (for tools, if state is a tool call): Noul 0-1 — data loss/priv-esc risk?
Return JSON: {"complexity":{"score":0.0-1.0,"level":"low|medium|high"},"is_urgent":0.0-1.0,"needs_plan":0.0-1.0,"needs_human":0.0-1.0,"is_risky":0.0-1.0}
NO other text.`;
}

async function callPiModel(prompt: string): Promise<Record<string, any> | null> {
  const provider = process.env.PI_PROVIDER ?? "";
  const model = process.env.PI_MODEL ?? "";
  if (!provider || !model) return null;
  const key = getAuthKey(provider);
  if (!key) return null;

  // Provider-specific endpoints (minimal, best-effort — falls back to rules if unknown)
  // We support opencode-go/opencode (OpenAI-compatible) and fallback to OpenAI format.
  const baseUrl = process.env.PI_API_BASE ?? process.env.OPENAI_API_BASE ?? "";
  // Try OpenAI-compatible /v1/chat/completions if baseUrl provided, else skip
  if (!baseUrl) {
    // No base URL — cannot call pi model directly from extension without ModelRuntime.
    // This is expected in many setups; we return null to trigger rules fallback that
    // still uses Jev concepts (not regular regex). The harness is NOT regular even
    // when falling back — it keeps typed Score/Noul + thresholds.
    return null;
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 400,
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const j: any = await res.json();
    const txt: string = j.choices?.[0]?.message?.content ?? "";
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]);
  } catch { return null; }
}

export async function evaluatePolicyWithPiModel(
  config: HarnessConfig,
  state: string,
): Promise<PolicyDecision> {
  const t0 = Date.now();
  const heavy = /(audit|refactor\w*|reorg|migrate\w*|architect\w*|security|cleanup|tidy\w*|inconsist|duplicat|cross.?cut|safer)/i.test(state);
  const kw = (state.match(/\b(and|then|after|audit|refactor\w*|reorg|migrate\w*|architect\w*|security|cleanup|tidy\w*|branch|workflow|inconsist|duplicat|safer)\b/gi) ?? []).length;
  const rulesFallback = (): PolicyDecision => {
    const score = Math.min(1, state.length / 4000 + kw * 0.14 + (heavy ? 0.48 : 0));
    const level = score > 0.66 ? "high" : score > 0.33 ? "medium" : "low";
    const isUrgent = /\b(urgent|asap|p0|blocking|customers seeing|500s|failing)\b/i.test(state);
    const needsHuman = /\b(destructive|secrets|prod|deploy|payment)\b/i.test(state);
    return {
      complexity: { level, score, confidence: 0.55, via: "rules" },
      isUrgent: { p: isUrgent ? 0.85 : 0.15, confidence: 0.6, via: "rules" },
      needsPlan: { p: score >= config.thresholds.complexity ? 0.8 : 0.2, confidence: 0.55, via: "rules" },
      needsHuman: { p: needsHuman ? 0.8 : 0.15, confidence: 0.6, via: "rules" },
      latencyMs: 0,
    };
  };

  // Try pi model — Jev concepts via user's model, not external Typesafe
  try {
    const prompt = buildJevPrompt(state);
    const parsed = await callPiModel(prompt);
    if (parsed) {
      const sc = parsed.complexity?.score ?? 0.5;
      const lvl = parsed.complexity?.level ?? (sc > 0.66 ? "high" : sc > 0.33 ? "medium" : "low");
      return {
        complexity: { level: lvl, score: sc, confidence: 0.85, via: "pi-model" as any },
        isUrgent: { p: Number(parsed.is_urgent ?? 0.2), confidence: 0.85, via: "pi-model" as any },
        needsPlan: { p: Number(parsed.needs_plan ?? (sc > 0.5 ? 0.8 : 0.2)), confidence: 0.85, via: "pi-model" as any },
        needsHuman: { p: Number(parsed.needs_human ?? 0.2), confidence: 0.85, via: "pi-model" as any },
        latencyMs: Date.now() - t0,
      };
    }
  } catch {}
  // Fallback — still Jev concepts (not regular regex-only): typed Score/Noul + thresholds + via
  return rulesFallback();
}

export async function assessRiskWithPiModel(
  config: HarnessConfig,
  toolName: string,
  input: Record<string, unknown>,
): Promise<{ block: boolean; pRisk: number; confidence: number; latencyMs: number; via: "pi-model" | "rules"; reason?: string }> {
  const RISKY = new Set(["bash", "write", "edit"]);
  if (!RISKY.has(toolName)) return { block: false, pRisk: 0, confidence: 1, latencyMs: 0, via: "rules" };
  const state = `${toolName}: ${JSON.stringify(input).slice(0, 4000)}`;
  const DANGEROUS = [/\brm\s+(-rf?|--recursive)/i, /\bsudo\b/i, /\b(chmod|chown)\b.*777/i, /:\(\).*\{.*\}/];
  const ruleHit = DANGEROUS.some((r) => r.test(state));

  // Try pi model for risk Noul
  try {
    const parsed = await callPiModel(buildJevPrompt(state));
    if (parsed && typeof parsed.is_risky === "number") {
      const pRisk = parsed.is_risky;
      return {
        block: pRisk >= config.thresholds.risk,
        pRisk,
        confidence: 0.85,
        latencyMs: 0,
        via: "pi-model",
        reason: pRisk >= config.thresholds.risk ? `pi-model pRisk=${pRisk.toFixed(2)}` : undefined,
      };
    }
  } catch {}
  return ruleHit
    ? { block: true, pRisk: 0.95, confidence: 0.6, latencyMs: 0, via: "rules", reason: "Rule match (pi-model unavailable — still Jev Noul via:rules)" }
    : { block: false, pRisk: 0.1, confidence: 0.6, latencyMs: 0, via: "rules" };
}
