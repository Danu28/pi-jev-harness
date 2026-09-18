// Pure pi-model harness — no apiKey, no baseUrl, no fallback.
// Uses PI_PROVIDER/PI_MODEL from pi session; calibration via jev_calibrate tool.
import { defaultConfig, type HarnessConfig } from "../types.ts";

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): HarnessConfig {
  return {
    ...defaultConfig,
    model: (env.JEV_MODEL as string) ?? defaultConfig.model,
  };
}
