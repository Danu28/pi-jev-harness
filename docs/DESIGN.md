# pi-jev-harness — TOOL-BASED PI-MODEL (NO FALLBACK)

## 1. No Fallback
As requested: **no `via:rules` fallback** — harness is pure pi-model. If calibration not called, tool_call blocks with "Jev calibration pending — must call jev_calibrate".

## 2. Calibration as Tool (Best — same session)
**Alternative considered:** `callPiModel(prompt) → POST /v1/chat/completions` fetch (needs PI_API_BASE + auth.json, separate LLM call, 2.5s abort). **Chosen: tool.** Why tool is best:
- Uses pi's native tool-calling loop — no extra fetch, no baseUrl, no key handling, no external service
- Parallel Questions in ONE tool (`jev_calibrate` 8 fields) — Jev blog: parallel barely adds cost
- Audited via `pi.appendEntry`, cached, thresholded, confidence — still Jev System-One
- If pi model mis-calls, harness blocks — self-correcting

### Tool — `src/harness/pi-classifier.ts`
```ts
jevCalibrateSchema = {state, complexity_score 0-1, complexity_level low/med/high, is_urgent/needs_plan/needs_human/is_risky 0-1, confidence}
calibrateToPolicy(p) → PolicyDecision via:pi-model
calibrateToRisk(p) → {block: pRisk>=0.85 via:pi-model}
buildJevInstruction(state) → "[JEV calibration required — call jev_calibrate tool now] STATE:... 5 parallel Questions..."
```

### Harness — `src/index.ts`
- `registerTool jev_calibrate` label "Jev Calibrate" — pi model calls it, execute stores lastPolicy/lastRisk + cache + appendEntry
- `before_agent_start`: if cached → reuse hint; else `pendingState=state; t0=now;` → inject `buildJevInstruction(state)` message (forces tool call next turn)
- `tool_call`: allow `jev_calibrate` always; for bash/write/edit → if !lastPolicy → block pending; else use last calibration's is_risky via:pi-model → confirm if block
- `session_start`: status `jev:pi-model provider/model` — proves NOT regular

## 3. NOT Regular Guarantees
Regular = regex, binary, bash-only, no calibration. This = **pi-model Qs, parallel, typed, thresholded, tool-audited, no fallback, no external deps**.
