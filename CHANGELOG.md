# Changelog

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
