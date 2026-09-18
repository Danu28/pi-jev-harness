# pi-jev-harness — Independent Jev Harness for Pi

> System One + System Two for pi. Jev handles fast classification, LLM handles generation.

Inspired by [LangChain's Building a Harness with Jev](https://www.langchain.com/blog/building-a-harness-with-jev) and TypeSafe's [System One models](https://typesafe.ai/blog/introducing-system-one-models-and-jev).

**Independent** — no dependency on `pi-brain` or `pi-pilot`. Drop-in pi extension (`pi install` / `pi -e ./src/index.ts`). Falls back to rule-based gates when `TYPESAFE_API_KEY` is missing.

## Architecture (3 layers)

```
User Prompt
   │
   ▼
┌─────────────────────────────────────────────┐
│  LAYER 1 — Core Jev Client (stateless)      │  src/jev-client.ts
│  POST https://api.typesafe.ai/v1/classify   │  types: Noul | Choice | Score
│  {state, questions:{}} -> {probs, conf}    │  parallel questions, calibrated
└──────────────┬──────────────────────────────┘
               │
   ┌───────────┼───────────┐
   ▼           ▼           ▼
┌────────┐ ┌────────┐ ┌─────────────┐
│LAYER 2 │ │LAYER 2 │ │LAYER 2      │  src/middleware/*
│Model   │ │AutoMode│ │Complexity   │
│Router  │ │RiskGate│ │Scorer       │
│Choice  │ │Noul    │ │Score+Noul   │
└───┬────┘ └───┬────┘ └──────┬──────┘
    │          │             │
    ▼          ▼             ▼
 pi.setModel  pi.on(tool_call)  pi.on(before_agent_start)
                block/confirm    inject plan hint
               ┌─────────────────────┐
               │ LAYER 3 — Harness  │  src/harness/*
               │ Orchestrator, Cache│
               │ /jev:* commands,   │
               │ Status widget,     │
               │ Config & Fallback  │
               └─────────────────────┘
```

### Event mapping vs LangChain

| LangChain | pi-jev-harness (pi events) |
|-----------|-------------------------|
| `ModelRouterMiddleware` | `pi.on("before_agent_start")` + `pi.setModel()` + `pi.on("model_select")` |
| `AutoModeMiddleware(tools=["bash"])` | `pi.on("tool_call")` for `bash/write/edit` → `{block, reason}` |
| `agent.state` probs | `pi.appendEntry("jev", result)` + `ctx.ui.setWidget()` |

## Quick start

```bash
# 1. API key (optional — without it, harness uses rule fallback)
export TYPESAFE_API_KEY=ts_xxx

# 2. Run with extension
pi -e ./src/index.ts "fix the failing deploy"

# 3. Or install globally
pi install ./Pi-Jev-Harness
```

## Commands

| Command | What it does |
|---------|--------------|
| `/jev:status` | Show last Jev classifications + latency/cost saved |
| `/jev:route` | Force re-route model (fast vs powerful) |
| `/jev:audit` | Dry-run risk gate on last tool calls |
| `/jev:config` | Toggle `TYPESAFE_API_KEY` / thresholds |

## Configuration

```jsonc
// ~/.pi/agent/settings.json or env
{
  "jev": {
    "model": "jev-latest",
    "thresholds": { "risk": 0.85, "urgent": 0.9, "complexity": 0.6 },
    "routing": { "fast": "openai:gpt-4o-mini", "powerful": "anthropic:claude-sonnet" },
    "cacheTtlMs": 30000,
    "fallback": "rules" // "block" | "allow" when no API key
  }
}
```

## Design doc

See `docs/DESIGN.md` for full independent harness design.
