# pi-jev-harness — Independent Design

## 1. Goal
Standalone harness that adds Jev System-One to pi without touching pi core or depending on pi-brain. Users can `pi install ./Pi-Jev-Harness` and get model routing + risk gating for free, with graceful fallback when `TYPESAFE_API_KEY` missing.

## 2. Layers

### Layer 1 — Core Client (`src/jev-client.ts`, `src/types.ts`, `src/harness/cache.ts`)
- Stateless `JevClient.classify({model, state, questions})` → `fetch` to `https://api.typesafe.ai/v1/classify`
- Types mirror TypeSafe docs: `Noul` (`{noul, confidence}`), `Choice` (`{choice, probs, confidence}`), `Score` (`{score, distribution, confidence}`)
- Parallel questions in one HTTP call (Blog: "barely changes latency")
- `JevCache` (TTL 30s, LRU 200) — memoize identical states to save cost
- `AbortController` timeout 3s — never blocks agent loop
- Pure TS, no pi imports → unit-testable with fetch mock

### Layer 2 — Middleware (pure functions, pi-agnostic)
| File | Jev Q | Pi Hook | Fallback |
|------|-------|---------|----------|
| `middleware/model-router.ts` | `Choice {fast, powerful}` | `before_agent_start` → `pi.setModel()` | regex: `architect|migrate|security` or len>4k → powerful |
| `middleware/auto-mode.ts` | `Noul is_risky` | `tool_call` → `{block, reason}` → `ctx.ui.confirm` | regex `rm -rf|suda|777` |
| `middleware/complexity.ts` | `Score low/med/high` + `Noul needs_plan` | `before_agent_start` injects `[JEV] complexity=high` hint | len/keyword heuristic |
Each middleware exports `async fn(client, config, state)` → decision object with `via: "jev"|"rules"` and `latencyMs`. No side effects.

### Layer 3 — Harness (`src/index.ts`, `src/harness/config.ts`)
- **Extension entry**: `export default function(pi: ExtensionAPI)` — standard pi extension contract
- **Config**: `resolveConfig(env)` reads `TYPESAFE_API_KEY`/`JEV_MODEL`/`JEV_BASE_URL` with `defaultConfig` thresholds `{risk:0.85, urgent:0.9, complexity:0.6}`
- **Events**:
  - `session_start` — set footer status `jev:jev` (green) or `jev:rules-fallback` (yellow)
  - `before_agent_start` — run router+complexity in parallel, cache route, `pi.appendEntry("jev",…)` for replay, setModel if confident
  - `tool_call` — assessRisk → block or confirm; always `appendEntry` for audit
- **Commands**: `/jev:status`, `/jev:audit`, `/jev:clear`
- **Widget**: `ctx.ui.setWidget("jev", [route, risk])` — live latency/via

## 3. Independence Guarantees
- Zero imports from `pi-brain`; own `package.json` with `"pi":{"extensions":["src/index.ts"]}`
- Works with `pi -e ./src/index.ts` or `pi install`
- When no API key: 100% rule-based, no network calls, still useful (lint-like)
- No `edit/write/bash` overrides — only gates via `tool_call` return `{block}` (pi's documented fail-safe)

## 4. Data flow (one turn)
```
User prompt → before_agent_start(state=prompt)
  ├─ cache.get(route:state) ? hit : Jev Choice (parallel)
  ├─ scoreComplexity (parallel Jev Score+Noul)
  └─ setModel + inject complexity hint
LLM thinks → tool_call({bash:"rm -rf /"})
  └─ assessRisk(Noul is_risky) → p=0.99 block → ctx.ui.confirm → {block:true}
      pi.appendEntry("jev", {type:"risk", pRisk, via})
```

## 5. Testing
- Unit: mock fetch → assert probs/conf parsing, fallback paths
- Integration: `pi -e ./src/index.ts -p "hello"` with/without key, check `/jev:status`
- Latency budget: Jev <30ms p95 vs LLM ~2s — harness never adds >50ms due to cache+timeout

## 6. Future (not v0.1)
- Add `urgent` Noul for triage, `entry-renderer` for pretty audit log
- Add `with-deps` for `zod/typebox` if needed
- Publish as `npm:pi-jev-harness` then `pi install npm:pi-jev-harness`
