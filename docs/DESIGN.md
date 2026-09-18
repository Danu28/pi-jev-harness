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

---

## 4. Phase Model
```
idle → awaitingCalibrate → awaitingPlan → ready
```
| Phase | Meaning | Next action |
|-------|---------|-------------|
| `idle` | No policy yet, no pending state | `call jev_calibrate` |
| `awaitingCalibrate` | `pendingState` set, instruction injected | pi model `→ jev_calibrate` |
| `awaitingPlan` | `policy.needsPlan>=0.5 && complexity!=low && !plan` | `→ jev_plan` (once) |
| `ready` | Policy (+plan if needed) present | proceed with `bash/write/edit/smart_bundle` gated by `is_risky` |
- `trivial bypass`: `isTrivialPrompt()` (`read/ls/hi` <60 chars) skips injection, ephemeral low policy `score 0.12 risk 0.06`, saves ~450 tok.
- `phaseOf()` in `src/harness/gate.ts` drives widget + card.

## 5. Tools & Commands
### Tools (7)
| Tool | Purpose | Schema |
|------|---------|--------|
| `jev_calibrate` | System-One 5 Qs (Score/Noul + confidence) | `src/harness/pi-classifier.ts:jevCalibrateSchema` |
| `jev_plan` | System-Two 2-7 steps `id/title/action/risk/needsHuman/dependsOn` | `src/harness/pi-planner.ts:jevPlanSchema` |
| `jev_git` | action `status/diff/log/commit/revert/init` + auto-message | `src/harness/pi-git.ts:jevGitSchema` |
| `jev_git_status/commit/diff/log` | Typed wrappers delegating to `handleJevGit` (AF-05) — LLM precision without impl dup | `src/index.ts:gitWrappers` |
> Gate: `TOOL_FAMILY` maps `smart_bundle → [read,edit,write,bash]` etc. for plan step matching.

### Commands (11, 8 primary + 3 aliases)
| Command | Description |
|---------|-------------|
| `/jev:status [--json]` | Card view (provider/phase/policy/plan bar/git/cost/thresholds/tips) or raw JSON |
| `/jev:plan` | Show last plan `formatPlanNotify` + `formatNextStep` |
| `/jev:next` | Show next step cursor |
| `/jev:help` | Full help — tools, all commands, aliases, tips, docs |
| `/jev:cost` | Telemetry `instr/compressed/latency/cached/trivialBypass` + `cache hits/misses/hitRate` |
| `/jev:config [risk 0.80 urgent 0.85]` | Live threshold tuning (mutates `HarnessConfig`) |
| `/jev:resume` | Resume cursor `Resuming N steps — Next: …` |
| `/jev:git [status|diff|log|commit|revert|init]` | Primary git surface |
| `/jev:log [n]` | **Alias** — prefer `/jev:git log` |
| `/jev:commit [msg]` | **Alias** — prefer `/jev:git commit` |
| `/jev:clear [--confirm|--restore]` | Clear cache with backup, or restore |

## 6. UI/UX Surfaces
- **Widget** `actionableWidgetLines()`: line1 `jev: <level> · risk <p> · <phase>` or `awaiting jev_calibrate · phase:<phase>`; line2 `plan:cur/tot next:id action · git:hash · <ch/cached/ms via> · [warn]` — capped 120ch, emoji fallback `⚠→[warn]` when `PI_NO_EMOJI/NO_EMOJI/NO_COLOR=1`, debounced 300ms.
- **Card** `cardStatus()`: header `provider/phase/turn`, `policy: badge score/urgent/needsPlan/risk via conf`, `plan: cur/tot bar maxRisk via` + `next:` + `why:`, `git: hash · action (undo: /jev:git revert hash)`, `cost: instr/compressed/latency/cached/hitRate/cache entries` (shown even when `no telemetry`), `nextAction`, `thresholds`, `tips: /jev:next /jev:plan /jev:cost /jev:help · /jev:resume · /jev:git · /jev:clear`. Bar `▓/░` falls back to `[cur/tot]` when `NO_COLOR/NO_EMOJI`. Responsive dividers via `process.stdout.columns`.
- **Confirm** `tool_call` gate: `Step sX (action: title) — reason\nHint:…\nWarn:…\nNext:…` + `Tool/Input(250ch)/Via`; Input truncated 250 + ellipsis, msg capped 400. `!hasUI` → block without confirm; with UI → `c.ui.confirm("Jev pi-model Gate", …)`.
- **Plan cards** `formatPlanDisplay/Notify/NextStep` in `src/harness/pi-planner.ts`: `useEmoji()` respects `PI_NO_EMOJI/NO_EMOJI/NO_COLOR`, `ACTION_ICON` vs `ACTION_ASCII`, `riskBadge` 🔴/🟡/🟢 minimal/low/medium/high, dividers responsive `Math.min(52, cols-28)`.
- **Auto-commit** `agent_settled`/`session_shutdown`: `🌿 auto-commit <hash> (undo: /jev:git revert <hash>)` + `appendEntry git:auto`.

## 7. Cost & Performance
- `compressState(1200)` head 650 + hash middle + tail 350; `normalizeState` + `simpleHash` → cache key `h:hash:prefix` (2000 truncated).
- Tiered instruction short (~80 tok) vs full (~220 tok) via `shouldUseShortInstruction`.
- Cache `JevCache` LRU 200 + TTL 300s + `persistCache()` fire-and-forget `.pi/jev-cache.json` (120 entries, 200k cap), `getSemantic(0.9)` token overlap.
- Coalesced git `status --porcelain --branch` single exec with fallback.
- Debounced widget 300ms, trivial bypass saves ~450 tok on `read/ls/hi`.

## 8. A11y & Terminal
- `PI_NO_EMOJI=1` / `NO_EMOJI=1` / `NO_COLOR=1` all disable emoji → ASCII fallbacks (`[high]/[med]/[low]`, `[read]` etc., `[warn]`).
- Responsive dividers/bars via `process.stdout.columns ?? 80`, second widget line capped 120ch with `…`.
- `suggestion.html` now lives at `docs/suggestion.html` (root `/suggestion.html` ignored) — 26 suggestions spec, dark/light `color-scheme`, not shipped (`package.json files` excludes `docs`).
