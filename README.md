# pi-jev-harness — PI-MODEL Jev Harness (TOOL, NO FALLBACK, NOT regular)

> **No fallback. Tool-based calibration in same session.** User prompt → build Jev prompt (5 parallel Questions: Score/Noul) → **pi model calls `jev_calibrate` tool** with JSON → `via:pi-model`.

**Flow (same session, not fetch):**
```
User: "Audit this project for safer refactoring"
  ↓ before_agent_start injects: [JEV calibration required — call jev_calibrate]
  ↓ pi model (PI_PROVIDER/PI_MODEL) calls: jev_calibrate {complexity_score:0.78, complexity_level:"high", is_urgent:0.2, needs_plan:0.9, needs_human:0.2, is_risky:0.1, confidence:0.88}
  ↓ tool execute → PolicyDecision via:pi-model → hints + widget + /jev:status
LLM → bash/write/edit → tool_call gate uses last calibration's is_risky via:pi-model → block/allow
```

**NOT regular extension:**
- Regular: `if (/rm -rf/.test(cmd)) block` binary bash-only
- **Jev tool:** 5 parallel Questions typed `Score/Noul + confidence + threshold` (risk 0.85), `via:pi-model`, audited, no regex, no Typesafe key, no PI_API_BASE, zero deps

Run: `pi -e ./src/index.ts` → footer `jev:pi-model opencode-go/muse-spark` → `/jev:status` shows `via:pi-model` calibration.
