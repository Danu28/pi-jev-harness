# pi-jev-harness — Pure Jev System-One Harness for Pi (No API Key Needed)

> **You're right — no `TYPESAFE_API_KEY` needed.** Harness runs 100% on rules that *are* Jev concepts.

Pure port of [Building a Harness with Jev](https://www.langchain.com/blog/building-a-harness-with-jev) to `pi`: Jev's **Noul/Score** decisions stubbed via heuristics — same Question shapes, same thresholds, `via:"rules"` 0ms, no network. Add `TYPESAFE_API_KEY` only to upgrade to calibrated Jev (`via:"jev"`).

## No key to run

```bash
pi -e ./src/index.ts "migrate DB for prod"
# footer: jev:rules (yellow) — true Jev harness, just heuristic
# /jev:status → {complexity:high via:rules, isUrgent:0.85 ...}
# /jev:audit  → risk gate still blocks rm -rf / sudo / secrets

# Optional upgrade (calibrated probs):
# export TYPESAFE_API_KEY=ts_xxx
# footer: jev:jev (green)
```

## Architecture — Zero deps, no model picking

```
User prompt → Policy Engine (1 batch, 4 Qs parallel, 0ms rules)
  Q1 Score complexity  Q2 Noul is_urgent  Q3 Noul needs_plan  Q4 Noul needs_human
  → [JEV policy via:rules] hint if needed
LLM → tool_call → Risk Gate Noul is_risky (pRisk 0.95 on rm -rf) → confirm/block
  → appendEntry + widget every turn
```

You keep `PI_MODEL` — harness never calls `setModel`. `dependencies:{}`.

## Config (all optional)

```ts
// src/types.ts — no apiKey required
thresholds: {risk:0.85, urgent:0.9, complexity:0.6}
model: "jev-latest", cacheTtlMs:30000, timeoutMs:3000
// env (optional): TYPESAFE_API_KEY / JEV_API_KEY, JEV_MODEL, JEV_BASE_URL
```

See `docs/DESIGN.md` — `via:"rules"` IS the harness, `via:"jev"` just calibrates it.
