# pi-jev-harness — PI-MODEL Jev Harness (TOOL, NO FALLBACK, NOT regular)

> **No fallback. Tool-based calibration in same session.** User prompt → build Jev prompt (5 parallel Questions: Score/Noul) → **pi model calls `jev_calibrate` tool** with JSON → `via:pi-model` → optional `jev_plan` + `jev_git`.

## Install

```bash
# try without installing
pi -e git:github.com/Danu28/pi-jev-harness

# install globally (recommended)
pi install git:github.com/Danu28/pi-jev-harness

# pin to tag
pi install git:github.com/Danu28/pi-jev-harness@v0.3.1

# update
pi update --extensions
```

## Flow (same session, not fetch)

```
User: "Audit this project for safer refactoring"
  ↓ before_agent_start injects: [JEV calibration required — call jev_calibrate]
  ↓ pi model (PI_PROVIDER/PI_MODEL) calls: jev_calibrate {complexity_score:0.78, complexity_level:"high", is_urgent:0.2, needs_plan:0.9, needs_human:0.2, is_risky:0.1, confidence:0.88}
  ↓ tool execute → PolicyDecision via:pi-model → hints + widget + /jev:status
  ↓ if needs_plan>=0.5 → jev_plan (2-7 steps, per-step risk) via:pi-model
  ↓ LLM → bash/write/edit → tool_call gate uses last calibration's is_risky via:pi-model → block/allow
  ↓ jev_git commit (auto-generates conventional msg from calibration/plan) or auto-commit on agent_settled
LLM → /jev:log /jev:git status — audit & revert
```

**NOT regular extension:**
- Regular: `if (/rm -rf/.test(cmd)) block` binary bash-only
- **Jev tool:** 5 parallel Questions typed `Score/Noul + confidence + threshold` (risk 0.85), `via:pi-model`, audited, no regex, no Typesafe key, no PI_API_BASE, zero deps

## Tools

- `jev_calibrate` — System-One: Score/Noul calibration (complexity, urgent, needs_plan, needs_human, is_risky)
- `jev_plan` — System-Two: 2-7 steps with per-step risk, `via:pi-model`, pretty `📋` card UI
- `jev_git` — Agent-friendly git: `status/diff/log/commit/revert/init`, auto-generates `feat(jev):` msgs, auto-commits on `agent_settled`, auto-inits repo

## Commands

`/jev:status` `/jev:plan` `/jev:git` `/jev:log` `/jev:commit [msg]` `/jev:clear`

## Dev

```bash
pi -e ./src/index.ts          # quick test (pi handles .ts directly)
npm run typecheck             # tsc --noEmit
npm test                      # vitest run  (33 tests)
npm run lint                  # eslint flat config
npx prettier --check src      # format check
```

> **Note on `allowImportingTsExtensions`**: `tsconfig.json` sets this so `src/*.ts` can `import "./x.ts"`. Pi's TS loader handles `.ts` extensions natively; for bundlers that don't, strip the extension or set `rewriteRelativeImportExtensions`.

Widget footer shows `jev:pi-model provider/model + plan:N + git:abc1234` — proves NOT regular.
