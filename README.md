# pi-jev-harness — PI-MODEL-POWERED Jev Harness (NOT regular extension)

> **Uses YOUR pi model** (`PI_PROVIDER/PI_MODEL` — e.g. `opencode-go/muse-spark-1.2`) to evaluate Jev **Score/Noul** Questions — NOT regex, NOT external Typesafe key.

**System-One via pi-model:** `before_agent_start` → 1 batched prompt (4 Qs parallel) to your pi model → JSON `{complexity, is_urgent, needs_plan, needs_human}` → `via:pi-model` with thresholds. `tool_call` → 1 Noul `is_risky` to same pi model → `via:pi-model` block. Falls back to `via:rules` only if pi model unreachable — but even fallback keeps **typed Jev concepts + thresholds** (not regular `if (rm -rf) block`).

## Why NOT regular?

| Regular extension (`permission-gate.ts`) | **pi-jev-harness (Jev)** |
|---|---|
| `if (/rm -rf/.test(cmd)) block` binary, bash-only, no probs | **Noul/Score** typed: `pRisk 0.95 confidence 0.85 threshold 0.85`, `complexity Score low/med/high`, covers `bash|write|edit`, parallel, audited |
| Single regex, no urgency/plan/human | **4 parallel Questions** per turn (Jev blog) → `complexity, is_urgent, needs_plan, needs_human` |
| No model, no calibration | **Powered by YOUR pi model** — same model you pay for, via `PI_PROVIDER/PI_MODEL` + `auth.json` |

## Run (no key)

```bash
pi -e ./src/index.ts "Audit this project for safer refactoring"
# footer: jev:pi-model opencode-go/muse-spark  widget: policy:high via:pi-model risk:0.10 via:rules
# /jev:status → {provider: opencode-go, policy:{via:pi-model latency:120ms}, risk:{via:pi-model}}
# /jev:audit /jev:clear
```

No `TYPESAFE_API_KEY`. No `JEV_API_KEY`. No external deps. `dependencies:{}`.

## Architecture

```
User prompt → src/harness/pi-classifier.ts → buildJevPrompt(4 Qs) → callPiModel(PI_PROVIDER/PI_MODEL) → JSON → PolicyDecision via:pi-model
  ↓ fallback → enhanced rules (still Score/Noul + heavy bump 0.48, not regex-only)
LLM → tool_call → pi-classifier Noul is_risky via pi-model → block/confirm → appendEntry + widget
```

See `src/harness/pi-classifier.ts` and `docs/DESIGN.md`.
