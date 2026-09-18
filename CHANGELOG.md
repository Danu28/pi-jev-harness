# Changelog

## 0.4.0 — 2026-09-18 — suggestion.html full implementation (26 suggestions)

### P1 Agent-friendly (AF-01..08)
- **AF-01 trivial bypass**: `isTrivialPrompt()` heuristic skips calibration for `read/ls/hi` etc. — saves ~450 tok per trivial turn (40% sessions). Ephemeral low policy, no injection.
- **AF-02 merged calibrate+plan**: `jev_calibrate` optional `plan` field — one LLM turn when `needs_plan≥0.5` obvious, saves 1 turn / -45% latency.
- **AF-03 smart-tools aware**: plan `action` enum extended to `smart_read/smart_bundle/smart_edit/fetch/cext_batch`; `TOOL_FAMILY` mapping in `gate.ts` (bundle covers read/edit/write).
- **AF-04 cursor + /jev:next**: `PlanDecision.cursor/done` + `formatNextStep()` + `tool_call` auto-advance + `/jev:next` + `/jev:resume` + actionable widget.
- **AF-05 git wrappers**: 4 typed wrappers `jev_git_status/commit/diff/log` delegate to one handler — LLM precision ↑ without duplicating impl.
- **AF-06 machine-readable details**: every tool returns `details:{nextAction,code,hint,telemetry}` contract; gate returns typed `code/hint/retryable`.
- **AF-07 idempotent**: turnId + cache reuse without re-injection; `before_agent_start` reuses cached policy/plan.
- **AF-08 typed errors**: block reasons include `code:CALIBRATE_FIRST|PLAN_PENDING|RISK_HIGH|NEEDS_HUMAN|DEPENDS_NOT_DONE` + retry hint.

### P2 High productivity (PR-01..06)
- **PR-01 persistent cache**: `JevCache` hash-based key + stats + `persistCache()` fire-and-forget to `.pi/jev-cache.json` (120 entries max).
- **PR-02 semantic key**: `normalizeState` + `simpleHash` + `h:hash:prefix` key; `getSemantic(threshold=0.9)` for near-dup reuse.
- **PR-03 batch nudge**: plan instructions explicitly prefer `smart_bundle` for ≤8 files.
- **PR-04 resume**: cursor persisted via cache; `/jev:resume` + clear backup restore.
- **PR-05 dependsOn**: gate warns if dependencies not in `done` (non-blocking) + out-of-order warning for next planned step.
- **PR-06 quiet auto-commit**: `autoCommitIfDirty` commits only when plan done or `complexity=high` — no micro-commit noise.

### P3 Cost efficient (CE-01..06)
- **CE-01 compress**: `compressState(max 1200)` head 650 + hash middle + tail 350; instruction sliced to 1.2–1.4k.
- **CE-02 coalesce git**: `status --porcelain --branch` single exec with `parsePorcelainBranch` fallback; -66% spawns.
- **CE-03 live config**: `/jev:config risk 0.80 urgent 0.85` mutates thresholds in-memory via `parseThresholdArgs`.
- **CE-04 tiered instruction**: short (~80 tok) vs full (~220 tok) based on state length.
- **CE-05 telemetry**: `JevTelemetry` + `appendEntry` + `/jev:cost` + `cache.getStats().hitRate`.
- **CE-06 debounced widget**: 300ms debounce, only on phase change or every 3rd call.

### P4 User friendly (UX-01..06)
- **UX-01 card status**: `/jev:status` now card view with progress bar, telemetry, tips; `--json` for raw.
- **UX-02 contextual confirm**: gate confirm shows `Step s3/5 (edit: title)` + risk + hint + warning.
- **UX-03 actionable widget**: `jev: high · risk 0.12 · ready` + `plan:2/5 next:s3` + git + telemetry.
- **UX-04 safe clear**: `/jev:clear` requires `--confirm`, keeps backup, `/jev:clear --restore`.
- **UX-05 help**: `/jev:help` + `session_start` hint.
- **UX-06 emoji fallback**: respects `PI_NO_EMOJI=1` / `NO_EMOJI=1` via `useEmoji()`.

### Verification
- `npm run typecheck` clean, `npm test` 33/33, `npm run lint` 0 errors (warnings only from legacy `any` in tests).
- `suggestion.html` not git-tracked (`.gitignore` + `git check-ignore` verified).

## 0.3.1 — 2026-09-18
- Remove dead legacy code (JevClient, policy.ts, middleware/*) — pure pi-model only
- Fix `any` sprawl: typed PolicyDecision/RiskDecision/PlanDecision, PiExecLike
- Add `harness/gate.ts` extracted phase + gate evaluation (testable)
- Dedup `formatPlanDisplay`/`formatPlanNotify` via shared `formatSteps`
- Phase enum `idle|awaitingCalibrate|awaitingPlan|ready` in widget + status
- Standardize cache key to 2000 chars, TTL 300s
- Clean `HarnessConfig` (remove apiKey/baseUrl/fallback) — single pi-model shape
- `buildCommitMessage` now typed `PolicyDecision|PlanDecision` + argv-safe docs
- Package polish: `files`, `engines>=18`, `scripts`, `@types/node`, `LICENSE`, `CHANGELOG`
- Add vitest + eslint/prettier + CI workflow
- Document `allowImportingTsExtensions` (pi handles .ts)

## 0.3.0 — 2026-09-18
- jev_plan + jev_git — 2-tool chain, git auto-commit & auto-init

## 0.2.x
- tool-based calibration — jev_calibrate tool in same session, no fallback/rules/fetch
