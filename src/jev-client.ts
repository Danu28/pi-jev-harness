/**
 * Core Jev Client — stateless HTTP, parallel questions, calibrated probs.
 * No pi dependency. Testable with fetch mock.
 */
import type { JevRequest, JevResponse, HarnessConfig } from "./types.ts";

export class JevClient {
  constructor(private config: HarnessConfig) {}

  get isConfigured(): boolean {
    return !!this.config.apiKey;
  }

  async classify(req: JevRequest): Promise<JevResponse> {
    if (!this.config.apiKey) throw new Error("TYPESAFE_API_KEY missing — use fallback");
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const start = Date.now();
    try {
      const res = await fetch(this.config.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ model: req.model, state: req.state, questions: req.questions }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Jev ${res.status}: ${txt.slice(0, 500)}`);
      }
      const raw: any = await res.json();
      return this.normalize(raw, Date.now() - start);
    } finally {
      clearTimeout(t);
    }
  }

  private normalize(raw: any, latencyMs: number): JevResponse {
    // TypeSafe returns flat {is_urgent:{noul:0.99}} — normalize to typed buckets
    const nouls: any = {};
    const choices: any = {};
    const scores: any = {};
    for (const [k, v] of Object.entries<any>(raw.answers ?? raw)) {
      if (v?.noul !== undefined) nouls[k] = { type: "noul", noul: v.noul, confidence: v.confidence ?? Math.abs(v.noul - 0.5) * 2 };
      else if (v?.choice) choices[k] = v;
      else if (v?.score !== undefined) scores[k] = v;
    }
    return { nouls, choices, scores, latencyMs, raw };
  }
}

export function stateFromToolCall(toolName: string, input: Record<string, unknown>): string {
  return `${toolName}: ${JSON.stringify(input).slice(0, 4000)}`;
}

export function stateFromPrompt(prompt: string, history?: string): string {
  return history ? `${history}\n\nUser: ${prompt}`.slice(0, 8000) : prompt.slice(0, 8000);
}
