# pi-jev-harness — Pure Jev Design (no model picking, zero deps)

## 1. Goal
Complete harness that is **Jev concepts only**: every fast decision is a typed Jev Question (Noul/Score/Choice) evaluated in parallel, with `rules` stubs that preserve the same Question shape when `TYPESAFE_API_KEY` missing. No pi-brain, no tools dep, no auto model switching — user owns `PI_MODEL`.

## 2. Layers

### Layer 1 — Core Client (`src/jev-client.ts`, `src/types.ts`, `src/harness/cache.ts`)
Stateless `JevClient.classify({model, state, questions})` → `fetch` + `AbortController 3s`. Types: `Noul` `Choice` `Score`. `JevCache` LRU200 TTL30s. No pi imports → mockable.

### Layer 2 — Policy Engine (`src/harness/policy.ts`)
**Single Jev batch per turn** — 4 parallel Questions (blog guarantee: parallel barely adds cost/latency):
- `complexity: Score {levels:[low,med,high]}`
- `is_urgent: Noul "conveys urgency"`
- `needs_plan: Noul "needs multi-step plan"`
- `needs_human: Noul "needs human confirmation"`

Fallback `rulesFallback()` mirrors same Qs: `len/6000 + kw*0.08` → score/level, regex for urgent/human. Returns `PolicyDecision {complexity, isUrgent, needsPlan, needsHuman, latencyMs}` with `via:"jev"|"rules"`. Cached by prompt slice.

### Layer 2b — Risk Gate (`src/middleware/auto-mode.ts`)
`tool_call` → `Noul is_risky` with `pRisk` vs `thresholds.risk=0.85`. Fallback: `DANGEROUS_RE` → `pRisk 0.95/0.10`. Covers `bash|write|edit` (not just bash like regular `permission-gate`). Returns `{block, pRisk, confidence, via}` — `via` visible in widget. On `block` with UI → `ctx.ui.confirm`, without UI → block.

### Layer 3 — Harness Loop (`src/index.ts`)
- `session_start`: `setStatus jev:jev|rules`
- `before_agent_start`: `evaluatePolicy` (one call) → `appendEntry("jev",{type:"policy"})`, `setWidget`, inject `[JEV policy ...]` hint only if `needsPlan/urgent/human` fires. Never `setModel`.
- `tool_call`: `assessRisk` → `appendEntry("jev",{type:"risk"})`, `setWidget`, block/confirm. Extra `warn` if `urgent+risk` combo.
- Commands: `/jev:status`, `/jev:audit`, `/jev:clear` — zero external tools, only `pi.*` APIs.

## 3. Independence
- `package.json` `dependencies:{}` — only `pi-coding-agent` types (peer)
- `src/middleware/model-router.ts` removed in v0.2 — no routing code exists
- Works with `pi -e ./src/index.ts` or `pi install` — no `pi-brain` or `with-deps`
- Graceful: no key → `via:"rules"` 0ms, still blocks + hints

## 4. Turn trace
```
prompt="deploy failed 500s asap" → policy batch → {complexity:high, isUrgent:0.92, needsHuman:0.7} via:jev
  → [JEV policy] urgent + needs-human hint injected
LLM → bash "rm -rf /tmp" → assessRisk Noul → pRisk 0.98 block → confirm
```

## 5. Testing
`tsc --noEmit` passes, no runtime deps. Mock fetch for Jev vs rules. `pi -p "hello"` with/without key → `/jev:status` shows `via`.
