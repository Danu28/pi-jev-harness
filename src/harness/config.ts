// No API key required — harness runs 100% on rules (Jev concepts stubbed).
// apiKey is optional: set TYPESAFE_API_KEY or JEV_API_KEY only to upgrade to calibrated Jev.
import { defaultConfig, type HarnessConfig } from "../types.ts";

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): HarnessConfig {
  return {
    ...defaultConfig,
    apiKey: env.TYPESAFE_API_KEY ?? env.JEV_API_KEY ?? undefined, // optional, defaults to rules mode
    model: (env.JEV_MODEL as string) ?? defaultConfig.model,
    baseUrl: env.JEV_BASE_URL ?? defaultConfig.baseUrl,
  };
}
