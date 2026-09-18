/**
 * AutoMode Risk Gate — Jev Noul: block risky tool calls BEFORE execution.
 * Mirrors LangChain AutoModeMiddleware(tools=["bash"]) but for pi's tool_call event.
 * Probabilities + confidence are logged via pi.appendEntry for audit.
 */
import type { JevClient } from "../jev-client.ts";
import type { HarnessConfig } from "../types.ts";

const RISKY_TOOLS = new Set(["bash", "write", "edit"]);
const DANGEROUS_RE = [/\brm\s+(-rf?|--recursive)/i, /\bsudo\b/i, /\b(chmod|chown)\b.*777/i, /:\(\).*\{.*\}/];

export interface RiskDecision { block: boolean; pRisk: number; confidence: number; latencyMs: number; via: "jev" | "rules"; reason?: string; }

export async function assessRisk(
  client: JevClient,
  config: HarnessConfig,
  toolName: string,
  input: Record<string, unknown>,
): Promise<RiskDecision> {
  if (!RISKY_TOOLS.has(toolName)) return { block: false, pRisk: 0, confidence: 1, latencyMs: 0, via: "rules" };

  const state = `${toolName}: ${JSON.stringify(input).slice(0, 4000)}`;
  const ruleHit = DANGEROUS_RE.some((r) => r.test(state));
  if (!client.isConfigured) {
    return ruleHit
      ? { block: true, pRisk: 0.95, confidence: 0.6, latencyMs: 0, via: "rules", reason: "Rule match (no Jev key)" }
      : { block: false, pRisk: 0.1, confidence: 0.6, latencyMs: 0, via: "rules" };
  }
  try {
    const res = await client.classify({
      model: config.model,
      state,
      questions: {
        is_risky: { type: "noul", instructions: "This tool call could cause data loss, exfiltration, privilege escalation, or irreversible side effects" } as any,
      },
    });
    const n = res.nouls["is_risky"];
    const pRisk = n?.noul ?? (ruleHit ? 0.9 : 0.1);
    const block = pRisk >= config.thresholds.risk;
    return { block, pRisk, confidence: n?.confidence ?? 0.5, latencyMs: res.latencyMs, via: "jev", reason: block ? `Jev pRisk=${pRisk.toFixed(2)} >= ${config.thresholds.risk}` : undefined };
  } catch {
    return ruleHit
      ? { block: true, pRisk: 0.9, confidence: 0.4, latencyMs: 0, via: "rules", reason: "Jev error, rule fallback" }
      : { block: false, pRisk: 0.2, confidence: 0.4, latencyMs: 0, via: "rules" };
  }
}
