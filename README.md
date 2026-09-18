# pi-jev-harness — Pure Jev System-One Harness for Pi

> No model picking. No external deps. One Jev batch per turn, one Noul gate per tool.

Pure port of [Building a Harness with Jev](https://www.langchain.com/blog/building-a-harness-with-jev) to `pi`: Jev handles **fast structured decisions**, LLM handles generation. Independent — `pi install ./Pi-Jev-Harness` or `pi -e ./src/index.ts`. Works offline (`rules` fallback), calibrates with `TYPESAFE_API_KEY`.

## Architecture — Complete Harness (no routing)

```
User prompt
   │
   ▼
┌─────────────────────────────────────────┐
│ Core: JevClient (src/jev-client.ts)     │  POST /v1/classify
│ {state, questions:{}} in parallel       │  Noul/Choice/Score types
└──────────────┬──────────────────────────┘
               │ single call, 4 Qs parallel (blog: barely adds latency)
               ▼
┌─────────────────────────────────────────┐
│ Policy Engine (src/harness/policy.ts)   │  before_agent_start
│ Q1 Score complexity low/med/high        │  Q2 Noul is_urgent
│ Q3 Noul needs_plan                      │  Q4 Noul needs_human
│ → via:jev rules fallback mirrors same Qs │  cache TTL 30s, 3s timeout
└──────────────┬──────────────────────────┘
               │ injects [JEV policy] hint if needed
               ▼
         LLM generates → tool_call
               │
               ▼
┌─────────────────────────────────────────┐
│ Risk Gate (src/middleware/auto-mode.ts) │  Noul is_risky
│ pRisk >=0.85 → confirm/block            │  covers bash/write/edit
└──────────────┬──────────────────────────┘
               │ appendEntry + widget
               ▼
        Execution or blocked
```

**No `ModelRouter`** — you keep control of `PI_MODEL`. Harness never calls `pi.setModel()`.

## Run

```bash
export TYPESAFE_API_KEY=ts_xxx  # optional — without it, via:"rules" heuristics
pi -e ./src/index.ts "migrate DB for prod"
# /jev:status  → policy + risk with via + latency
# /jev:audit   → last tool risk
# /jev:clear   → clear cache
```

Status footer: `jev:jev` (green, calibrated) or `jev:rules` (yellow, offline). Widget: `policy:high via=jev risk:0.12`.

## Config (no routing)

```ts
// src/types.ts defaultConfig
thresholds: { risk:0.85, urgent:0.9, complexity:0.6 }
model: "jev-latest", cacheTtlMs:30000, timeoutMs:3000
// env: TYPESAFE_API_KEY / JEV_API_KEY, JEV_MODEL, JEV_BASE_URL
```

## Why this helps you (end user)

* Safety without LLM: calibrated Noul before every `bash/write/edit`
* Guardrails without prompts: plan hint when Score=high, urgent/human nudges
* Zero workflow change, zero deps, auditable (`appendEntry "jev"`)

See `docs/DESIGN.md` for pure Jev design.
