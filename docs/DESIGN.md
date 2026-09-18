# pi-jev-harness — PI-MODEL-POWERED Jev Design (NOT regular)

## 1. Goal
Harness that **uses the user's active pi model** for every fast decision — Jev concepts (Noul/Score) evaluated by `PI_PROVIDER/PI_MODEL` (e.g. `opencode-go/muse-spark-1.2`), not external Typesafe, not regex-only. `via:pi-model` vs `via:rules` (fallback) proves it's Jev, not regular.

## 2. System-One via pi-model

### Core — `src/harness/pi-classifier.ts`
- `buildJevPrompt(state)` — structured prompt with 4 parallel Questions (complexity Score + 3 Noul + is_risky for tools), asks for JSON only.
- `callPiModel(prompt)` — reads `PI_PROVIDER/PI_MODEL` + `auth.json` key + `PI_API_BASE` (if set), POST `/v1/chat/completions` OpenAI-compatible, 2.5s abort, parses `{...}` JSON. Returns `null` if no provider/base → fallback.
- `evaluatePolicyWithPiModel` — one batch 4 Qs via pi-model → `PolicyDecision via:pi-model confidence 0.85`. Fallback: enhanced rules (heavy bump 0.48, kw 0.14, not binary) → `via:rules` but still typed Score/Noul + thresholds.
- `assessRiskWithPiModel` — per-tool Noul `is_risky` via same pi-model, `via:pi-model` else fallback `via:rules` with DANGEROUS_RE 0.95/0.10.
Even fallback is Jev: typed probs, thresholds, parallel, audited — not regular `if (cmd.includes('rm'))`.

### Harness Loop — `src/index.ts`
- `session_start`: `setStatus jev:pi-model provider/model` (shows pi-model powering Jev, not regex)
- `before_agent_start`: `evaluatePolicyWithPiModel` (one pi-model call, 4 Qs parallel) → `appendEntry("jev",{provider, policy})`, `setWidget`, inject `[JEV pi-model via:pi-model latency:120ms provider:opencode-go/...]` hint
- `tool_call`: `assessRiskWithPiModel` → `appendEntry`, `setWidget policy:high via:pi-model risk:0.12 via:pi-model`, `confirm` with `via`+`provider`
- Commands: `/jev:status /jev:audit /jev:clear` — show provider + via

## 3. NOT Regular Extension Guarantees
- Regular: single regex, bash-only, binary block. Jev: **5 typed Questions (Score + 4 Noul), parallel, thresholded (risk 0.85 etc), confidence, via, audit**.
- Regular: no model. Jev: **PI_MODEL** — reuses your auth.json key, no extra cost beyond one tiny prompt vs full agent loop (System-One fast).
- Regular: no observability. Jev: **widget + appendEntry + /jev:status** with `via:pi-model` proof.
- Zero deps, zero Typesafe key, never calls `setModel` (you own PI_MODEL).

## 4. Fallback is still Jev
When pi model unavailable (no PI_API_BASE or fetch fail), `via:rules` uses same Question shapes + heavy concept scoring (0.48) + thresholds, so harness behavior is identical — just calibrated via pi-model when reachable.
