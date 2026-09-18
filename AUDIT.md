# Audit — pi-jev-harness v0.4.0 — 5-Step Algorithm

**Date:** 2026-09-18 · **Via:** pi-model jev_calibrate `high/0.75 needs_plan 0.85` → 5-step Systematic Audit
**Rule:** *Never optimize something that shouldn't exist.*

---

## 0. Inventory (s1)

| Metric | Value |
|---|---|
| Total LOC | 2,437 (src) — `src/index.ts` 996 lines = **41% in one file** |
| Modules | 8 src files + 5 test files |
| Runtime deps | **0** (zero-deps claim holds) |
| Dev deps | 7 (typescript, vitest, eslint+r plugins, prettier, @types/node, esbuild via vite) |
| node_modules | 83 MB |
| dist | 117 KB (but `npm run build` **FAILS** — see P0) |
| Tests | 33/33 pass, 5 files, ~746ms |
| Typecheck | `tsc --noEmit` ✅ clean |
| Lint | 0 errors, **23 warnings** (all `any`/`as unknown`) |
| Tools registered | 7 (`jev_calibrate`, `jev_plan`, `jev_git` + 4 wrappers) |
| Commands | 11 (8 primary + 3 aliases) |
| State vars in index.ts | 13 mutable `let`s, 111 references |

---

## 1. QUESTION — Challenge Every Requirement

> If a requirement survives questioning, it earns the right to be optimized. Otherwise it gets deleted before step 2.

| Requirement / Feature | Challenge | Verdict |
|---|---|---|
| **Pure pi-model, no fallback, no fetch, no external service** | Core differentiator vs "regular" regex gate. Without this, project is a commodity. | **KEEP — essence** |
| **jev_calibrate (5 parallel Qs)** | Could we calibrate with 1 Q? No — Jev System-One spec requires parallel Score+Noul. Cost barely scales. | **KEEP** |
| **jev_plan separate turn (once per task)** | User asked to merge calibrate+plan (AF-02). Kept separate as "once per task" — is 1 extra turn worth clarity + auditability? For `medium` tasks, plan is overhead. Gate already allows skipping when `complexity=low`. | **KEEP but gate tighter** — only inject plan when `complexity=high` or `needsPlan>0.7` (see Simplify) |
| **jev_git + 4 wrappers + 3 git commands** | Source of 14KB `pi-git.ts` + 5 tool registrations. Does an *agent harness* need to own git? `autoCommitIfDirty` + `/jev:git` duplicates what `pi` already does via `bash`. | **QUESTIONABLE — candidate to DELETE wrappers** (keep one `jev_git` with `action` enum; delete `jev_git_status/commit/diff/log` wrappers). Saves 4 tool registrations, ~80 lines. |
| **11 commands** (`/jev:status|plan|next|help|cost|config|resume|git|log|commit|clear`) | `log`≡`git log`, `commit`≡`git commit` — aliases for discoverability vs bloat. `resume/next/plan` overlap. `cost` niche. | **TRIM to 7**: `status, plan, next, help, cost, git, clear` — delete aliases `log`/`commit` and fold `resume` into `next`. |
| **Widget + Card + Notify + Plan formatting** | 4 surfaces for same data, emoji/NO_EMOJI branching everywhere, responsive dividers via `process.stdout.columns`. High code for low value in headless CI. | **KEEP widget+card only**, downgrade notify formatting to plain. Remove emoji branching duplication (extract `useEmoji()` once — already done, but still 6 call sites). |
| **Persistent cache `.pi/jev-cache.json` (PR-01)** | Fire-and-forget `import("node:fs").then(mkdir+writeFile)` inside `persistCache()` — async, untestable, never read back on startup (hydration is `loadCache?.()` which doesn't exist). Writes 120 entries on every calibrate. | **DELETE or FIX** — currently write-only, never hydrated. Either implement real `readFile` hydration or delete file I/O entirely (in-memory LRU is sufficient for session). |
| **Semantic cache `getSemantic(0.9)`** | Scans up to 200 entries with token Set overlap on every miss — O(n) per miss, but n=200 small. Benefit unproven (no metric that it ever hits). | **MEASURE or DELETE** — add telemetry counter; if hitRate <2% over 30 days, delete. |
| **Trivial bypass `isTrivialPrompt()`** | Saves ~450 tok on `hi/read/ls`. Regex heuristic, 40% sessions per CHANGELOG. | **KEEP** — highest ROI cost optimization. But simplify regex list. |
| **Compression `compressState(1200)` + tiered instruction** | Head 650 + hash + tail 350. Saves tokens but adds `simpleHash` + branching. | **KEEP** — low cost, real saving. |
| **docs/suggestion.html (26 suggestions)** | Referenced in DESIGN.md but `package.json files` excludes `docs` and `.gitignore` ignores `/suggestion.html`. Doc exists but not shipped. | **KEEP in repo, ensure not shipped** — already correct. Question whether 26 suggestions should remain open or be archived as completed. |
| **Package `pi` field `extensions: [src/index.ts]`** | Pi loads TS directly, but `allowImportingTsExtensions` breaks `tsc -p` build. | **KEEP but fix tsconfig** (P0) |

**Summary of Q:** 3 candidates fail the question: `jev_git_*` wrappers, command aliases, persistent file cache. Everything else earns the right to be optimized.

---

## 2. DELETE — Remove Anything Unnecessary

> Never optimize what shouldn't exist. Delete first.

### P0 — Must delete/fix now
| # | What | Why | Lines saved |
|---|---|---|---|
| D1 | **Fix `tsconfig.json` build break** — `allowImportingTsExtensions` requires `noEmit` or `emitDeclarationOnly`, but `tsc -p` emits to `dist`. Build currently fails. Either set `"noEmit":false`+ remove flag, or add `rewriteRelativeImportExtensions` / strip `.ts` imports. | Build is red. | 0 (config) |
| D2 | **Delete `.pi/jev-cache.json` write-only persistence** OR implement hydration. Currently `persistCache()` writes but startup does `pi.loadCache?.()` which never returns data. Dead I/O, 30 lines + 200KB cap. | Dead code, confuses audit. | ~30 lines |
| D3 | **Delete 4 `jev_git_*` wrapper tool registrations** — `jev_git_status/commit/diff/log` all delegate to `handleJevGit`. Keep single `jev_git` with `action` enum. LLM can already call `jev_git {action:"status"}`. | -66% tool surface | ~80 lines + 4 registrations |

### P1 — High value deletions
| # | What | Why | Lines saved |
|---|---|---|---|
| D4 | **Delete command aliases** `/jev:log` and `/jev:commit` — aliases of `/jev:git log|commit`. One surface, less help text. | Duplicate | ~60 lines (2 handlers) |
| D5 | **Fold `/jev:resume` into `/jev:next`** — both show next step; `resume` is alias. | Duplicate | ~20 lines |
| D6 | **Delete unused import/state** — `void lastWasLowRisk`, `void cached`, `isTrivialPrompt` branch imports `node:fs` dynamically but never awaited. Remove dead `void` silencing. | Lint noise | ~10 lines |
| D7 | **Remove duplicate `process.stdout.columns` reads** — `pi-planner.ts` reads cols twice, `index.ts` card also. Extract `getCols()` util. | DRY | ~5 lines |
| D8 | **Archive `suggestion.html` TODOs** — CHANGELOG says 26 suggestions implemented, but `suggestion.html` still referenced as active spec. Move to `docs/archive/` or add `IMPLEMENTED` badge so audit doesn't re-audit. | Clarity | docs |

### P2 — If time
| # | What | Where |
|---|---|---|
| D9 | `getSemantic()` if telemetry shows <2% hit rate over 100 sessions | `src/harness/cache.ts:63` |
| D10 | `TOOL_FAMILY` reverse lookup (rare path `rev` matching) — YAGNI until `cext_batch` actually used | `src/harness/pi-planner.ts` |
| D11 | `ensureGitConfig` called 4× — dedup to once per `handleJevGit` entry | `src/harness/pi-git.ts` |

**Total deletable without behavior loss: ~205 lines (~8% codebase) + 4 tools + 3 commands.**

---

## 3. SIMPLIFY — Optimize What Remains

After deletion, simplify the survivors.

| Area | Current pain | Simplification |
|---|---|---|
| **S1 God file `src/index.ts` 996 lines** | 13 mutable lets, 111 refs, widget+card+gate+tool handlers interleaved. Hard to test, hard to review. | **Split into 4 modules**: `src/extension/bootstrap.ts` (register), `src/extension/widget.ts` (widget+card), `src/extension/lifecycle.ts` (before_agent_start/tool_call/agent_settled), `src/harness/persist.ts` (if kept). Index becomes ~80-line composition. Each module independently testable. |
| **S2 `as unknown as` / `any` sprawl** | 23 lint warnings, 21 `as unknown` + 6 `as any` in index.ts. Masks real type errors; `PiExecLike` exists but not used in index.ts. | Define `type PiAPI = ExtensionAPI & { exec?, appendEntry?, loadCache? }` once, use everywhere. Replace `as unknown as Record<string,unknown>` on schemas with `satisfies` + typed helper `registerTool<T extends Schema>(name, schema: T)`. Target 0 warnings. |
| **S3 Cache key** | `cache.ts:10-24` branching: `if (truncated<400 && !includes(" "))` preserve legacy vs `h:hash:prefix`. Two key schemes for test compat. | Keep single scheme `h:hash:prefix` always; update tests to expect hashed keys (4 tests change). Halves `key()` complexity. |
| **S4 Config** | `resolveConfig` reads `JEV_RISK/JEV_URGENT/JEV_TTL/JEV_MODEL` but `parseThresholdArgs` duplicates parsing for `/jev:config`. No validation (negative risk accepted). | Extract `parseThresholdValue(k,v)` validator shared by both; clamp `0..1` and ignore NaN/negative. |
| **S5 Gate** | `evaluateGate` has 3 early returns + plan-step scan + `needsHumanStep` second scan (linear twice). Commented-out `dependsOn`/`out-of-order` warnings left as dead comments. | Remove commented code, single scan returning `{step, needsHumanStep}`. Extract `PHASE_GUARD` table for `CALIBRATE_FIRST/PLAN_PENDING` checks. |
| **S6 Planner display** | `formatPlanDisplay` vs `formatPlanNotify` vs `formatNextStep` share `formatSteps` but differ in divider length + emoji logic. Duplicated `Math.min(52, Math.max(24, cols-28))`. | Single `formatPlan(decision, {mode:"card"|"notify"|"next", withDeps})` + constants `DIVIDER_CARD=52, DIVIDER_NOTIFY=44`. |
| **S7 Import style** | Mixed `import "./x.ts"` (.ts extension required by `allowImportingTsExtensions` but breaks `tsc`). | Adopt `rewriteRelativeImportExtensions` (TS 5.6+) or strip `.ts` — whichever survives P0 fix; enforce via lint rule `no-restricted-imports` pattern `\.ts$`. |

**Principle:** Each simplification must reduce either cyclomatic complexity or mutable state count. No "clever" abstractions for single call sites.

---

## 4. ACCELERATE — Make It Faster

> Only after delete + simplify. Measured, not guessed.

| Bottleneck | Evidence | Acceleration | Expected gain |
|---|---|---|---|
| **A1 Test wall 746ms** | `vitest` `prepare 942ms` dominates — `transform 204ms, collect 424ms`. `prepare` is Vite dep pre-bundling for 83MB node_modules. | Switch `vitest.config.ts` to `deps.inline: [/.*/]`? No — better: `cacheDir: ".vitest"` + `deps.optimizer` already; real fix is **reduce node_modules** (see A4). | -300ms cold, -600ms warm |
| **A2 Cache scan O(200) on miss** | `getSemantic()` loops 200 entries with `Set` allocation per entry. On 90% misses, wasted. | Gate `getSemantic` behind `if (miss && state.length>200)` and early exit after 3 candidates via top-k overlap, or add `Map<string, Set>` pre-tokenized. | ~0.2ms per call (micro) |
| **A3 Widget debounce 300ms** | `widgetDebounceUntil` checked every `tool_call` but still builds `actionableWidgetLines()` eagerly. | Return early before formatting if `Date.now() < debounceUntil` and phase unchanged. Avoids string alloc on hot path. | ~1-2ms per tool_call saved |
| **A4 node_modules 83MB for 0 runtime deps** | All deps are dev, but `eslint+ @typescript-eslint + prettier + vitest/vite/esbuild` pull 82MB. `npm ci` 3-5s. | Consider `eslint` flat config already minimal; `prettier` could be `prettier --check` via `npx` without install? No — keep. Real win: **enable `npm ci --prefer-offline` in CI and cache `~/.npm` + `node_modules`** (already in GitHub Actions `setup-node cache:npm`). Document `npm ci --ignore-scripts` not needed (no postinstall). | -40% CI wall time |
| **A5 `compressState` regex** | `state.replace(/(\S+\.\w+)(,\s*\1)+/g, ...)` runs on every instruction build (1.4k slice). Regex with backref is costly. | Only run dedup if `state.includes(",") && state.length>1200` (already size-gated); pre-check avoids regex on short states. | ~0.1ms |
| **A6 Git coalesce already done** | `status --porcelain --branch` single exec (CE-02) — good. | Keep; add `execGit` memoization for `rev-parse --is-inside-work-tree` within same turn (cache 5s). Saves 1 spawn per `autoCommitIfDirty` path. | -1 spawn/turn |

**No speculative optimization.** Each A has a micro-benchmark or CI timing to validate. Target: **warm test <400ms, widget <1ms.**

---

## 5. AUTOMATE — Automate Only After Above

> Automation cements the simplified, accelerated path. Never automate a bloated process.

| Automation | Trigger | What it does | Guard |
|---|---|---|---|
| **AU1 Fix build in CI** | `npm run build` currently fails | Add to `ci.yml` after `npm run typecheck`: `- run: npm run build` — then fix tsconfig so it passes. Prevents future break. | Block merge if build fails |
| **AU2 Lint zero-warnings gate** | `eslint` currently 23 warnings | Change `ci.yml` `npx eslint src --ext .ts` → `npx eslint src --max-warnings 0` after S2 lands. Warnings become errors. | Needs S2 first |
| **AU3 Coverage gate** | No coverage threshold today | `vitest.config.ts` `coverage: { thresholds: { lines:80, branches:70 }}` + `npm run test -- --coverage` in CI (weekly, not per-push to save time). | Advisory first, then required |
| **AU4 Auto-cache warm** | Trivial sessions bypass calibrate | Already automated via `isTrivialPrompt()` — add metric `trivialBypassCount` to `/jev:cost` and CI log once/week. No new code. | Observe |
| **AU5 Release automation** | Manual `CHANGELOG.md` | `release.yml` workflow: on tag `v*`, run `npm run build && npm publish --dry-run` + `gh release create` from `CHANGELOG.md` top section. | Needs `NPM_TOKEN` |
| **AU6 Dependency freshness** | 83MB dev deps drift | `renovate.json` or `dependabot.yml` weekly for `devDependencies` only; auto-merge patch/minor if `typecheck+test+lint` green. | Low risk (dev only) |

**Not automated (deliberately):** auto-merge for runtime deps (none), auto-commit on every dirty state (kept quiet per PR-06 — only `medium/high` or plan-done).

---

## Prioritized Backlog (Rule applied)

### Now (next PR)
1. **P0 D1** — fix `tsconfig.json` so `npm run build` passes (add `"emitDeclarationOnly": false` or remove `allowImportingTsExtensions`, strip `.ts` imports). Add `npm run build` to CI.
2. **P0 D2/D3** — delete persistent file cache I/O or implement hydration; delete `jev_git_*` wrappers.
3. **S1** — split `src/index.ts` 996→ ~4×250-line modules.

### Next
4. **D4/D5 S2 S3** — delete aliases, zero `any`/`as unknown`, single cache key scheme.
5. **A3 A6** — widget early-return, `rev-parse` memo.
6. **AU1 AU2** — CI build + `max-warnings 0`.

### Later (when metrics justify)
7. D9 — delete `getSemantic` if hitRate<2%.
8. AU3 AU5 AU6 — coverage, release, renovate.

---

## Risks & Assumptions

- Splitting god file risks merge conflicts — do on clean `main` with no parallel feature branches.
- Deleting wrappers is breaking for LLMs that learned `jev_git_status` — keep handlers as aliases delegating to `jev_git` for one minor version with deprecation warning, then remove in next major.
- `allowImportingTsExtensions` fix touches every import — test with `pi -e ./src/index.ts` manual smoke (pi loader handles `.ts`).

---

## How to use this audit

```bash
# reproduce findings
npm run typecheck && npm test && npm run lint  # typecheck ok, tests 33/33, lint 23 warnings
npm run build                                  # FAILS — P0
du -sh node_modules                            # 83M
wc -l src/index.ts                             # 996
rg "as unknown" src/ | wc -l                   # 21
```

Pick a lane from **Now** and run `/jev:status` after each step — the card will show `phase/warnings` shrinking.
