import { describe, it, expect } from "vitest";
import { evaluateGate, phaseOf } from "./gate.ts";
import type { HarnessConfig } from "../types.ts";

const config: HarnessConfig = {
  model: "jev-latest",
  thresholds: { risk: 0.85, urgent: 0.9, complexity: 0.6 },
  cacheTtlMs: 300_000,
};

function policy(over: Partial<Record<string, unknown>> = {}) {
  return {
    complexity: { level: "high" as const, score: 0.8, confidence: 0.9, via: "pi-model" as const },
    isUrgent: { p: 0.1, confidence: 0.9, via: "pi-model" as const },
    needsPlan: { p: 0.9, confidence: 0.9, via: "pi-model" as const },
    needsHuman: { p: 0.1, confidence: 0.9, via: "pi-model" as const },
    latencyMs: 10,
    ...over,
  } as any;
}

describe("phaseOf", () => {
  it("idle", () =>
    expect(
      phaseOf({ policy: null, risk: null, plan: null, pendingState: null, pendingPlanState: null }),
    ).toBe("idle"));
  it("awaitingCalibrate", () =>
    expect(
      phaseOf({ policy: null, risk: null, plan: null, pendingState: "x", pendingPlanState: null }),
    ).toBe("awaitingCalibrate"));
  it("awaitingPlan", () =>
    expect(
      phaseOf({
        policy: policy(),
        risk: null,
        plan: null,
        pendingState: null,
        pendingPlanState: "x",
      }),
    ).toBe("awaitingPlan"));
  it("ready", () =>
    expect(
      phaseOf({
        policy: policy(),
        risk: null,
        plan: null,
        pendingState: null,
        pendingPlanState: null,
      }),
    ).toBe("ready"));
});

describe("evaluateGate", () => {
  it("jev tools always allow", () => {
    const s: any = {
      policy: null,
      risk: null,
      plan: null,
      pendingState: "x",
      pendingPlanState: null,
    };
    expect(evaluateGate(config, s, "jev_calibrate").block).toBe(false);
    expect(evaluateGate(config, s, "jev_plan").block).toBe(false);
    expect(evaluateGate(config, s, "jev_git").block).toBe(false);
  });
  it("blocks when no policy but pendingState", () => {
    const s: any = {
      policy: null,
      risk: null,
      plan: null,
      pendingState: "hello",
      pendingPlanState: null,
    };
    const r = evaluateGate(config, s, "bash");
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/calibration pending/);
  });
  it("blocks risky tools until plan", () => {
    const s: any = {
      policy: policy(),
      risk: { decision: { pRisk: 0.1, via: "pi-model" } },
      plan: null,
      pendingState: null,
      pendingPlanState: "state",
    };
    expect(evaluateGate(config, s, "bash").block).toBe(true);
    expect(evaluateGate(config, s, "read").block).toBe(false);
  });
  it("global pRisk blocks", () => {
    const s: any = {
      policy: policy({ needsPlan: { p: 0.1 } }),
      risk: { decision: { pRisk: 0.9, via: "pi-model" } },
      plan: null,
      pendingState: null,
      pendingPlanState: null,
    };
    const r = evaluateGate(config, s, "bash");
    expect(r.block).toBe(true);
    expect(r.pRisk).toBe(0.9);
  });
  it("per-step risk overrides global", () => {
    const s: any = {
      policy: policy({ needsPlan: { p: 0.1 }, complexity: { level: "low", score: 0.2 } }),
      risk: { decision: { pRisk: 0.1, via: "pi-model" } },
      plan: { steps: [{ id: "s1", title: "x", action: "bash", risk: 0.92 }], maxRisk: 0.92 },
      pendingState: null,
      pendingPlanState: null,
    };
    const r = evaluateGate(config, s, "bash");
    expect(r.block).toBe(true);
    expect(r.pRisk).toBe(0.92);
    expect(r.via).toBe("pi-model:plan");
  });
  it("needsHuman blocks via plan", () => {
    const s: any = {
      policy: policy({ needsPlan: { p: 0.1 } }),
      risk: { decision: { pRisk: 0.1, via: "pi-model" } },
      plan: {
        steps: [{ id: "s2", title: "y", action: "write", risk: 0.1, needsHuman: true }],
        maxRisk: 0.1,
      },
      pendingState: null,
      pendingPlanState: null,
    };
    expect(evaluateGate(config, s, "write").block).toBe(true);
  });
  it("non-risky read allowed", () => {
    const s: any = {
      policy: policy({ needsPlan: { p: 0.1 } }),
      risk: { decision: { pRisk: 0.1, via: "pi-model" } },
      plan: null,
      pendingState: null,
      pendingPlanState: null,
    };
    expect(evaluateGate(config, s, "read").block).toBe(false);
  });
});
