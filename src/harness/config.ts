import { defaultConfig, type HarnessConfig } from "../types.ts";

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): HarnessConfig {
  return {
    ...defaultConfig,
    apiKey: env.TYPESAFE_API_KEY ?? env.JEV_API_KEY,
    model: (env.JEV_MODEL as string) ?? defaultConfig.model,
    baseUrl: env.JEV_BASE_URL ?? defaultConfig.baseUrl,
  };
}
