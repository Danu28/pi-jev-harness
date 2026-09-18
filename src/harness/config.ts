// Pure pi-model harness — enhanced with live threshold tuning.
import { defaultConfig, type HarnessConfig } from "../types.ts";

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): HarnessConfig {
  const risk = env.JEV_RISK ? parseFloat(env.JEV_RISK) : undefined;
  const urgent = env.JEV_URGENT ? parseFloat(env.JEV_URGENT) : undefined;
  const ttl = env.JEV_TTL ? parseInt(env.JEV_TTL, 10) : undefined;
  return {
    ...defaultConfig,
    model: (env.JEV_MODEL as string) ?? defaultConfig.model,
    thresholds: {
      risk: risk !== undefined && !isNaN(risk) ? risk : defaultConfig.thresholds.risk,
      urgent: urgent !== undefined && !isNaN(urgent) ? urgent : defaultConfig.thresholds.urgent,
      complexity: defaultConfig.thresholds.complexity,
    },
    cacheTtlMs: ttl !== undefined && !isNaN(ttl) ? ttl : defaultConfig.cacheTtlMs,
  };
}

export function parseThresholdArgs(args: string): Partial<HarnessConfig["thresholds"]> | null {
  const m = args.trim();
  if (!m) return null;
  const out: Record<string, number> = {};
  const pairs = m.split(/\s+/);
  for (let i = 0; i < pairs.length; i += 2) {
    const k = pairs[i]?.toLowerCase();
    const v = parseFloat(pairs[i + 1]);
    if (!k || isNaN(v)) continue;
    if (k === "risk" || k === "urgent" || k === "complexity") out[k] = v;
  }
  return Object.keys(out).length ? (out as Partial<HarnessConfig["thresholds"]>) : null;
}
