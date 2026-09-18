import { describe, it, expect } from "vitest";
import { calibrateToPolicy, calibrateToRisk, buildJevInstruction } from "./pi-classifier.ts";
import type { HarnessConfig } from "../types.ts";

const cfg: HarnessConfig = {
  model: "jev-latest",
  thresholds: { risk: 0.85, urgent: 0.9, complexity: 0.6 },
  cacheTtlMs: 300_000,
};

describe("calibrateToPolicy", () => {
  it("maps fields", () => {
    const p: any = {
      state: "hello",
      complexity_score: 0.7,
      complexity_level: "high",
      is_urgent: 0.2,
      needs_plan: 0.9,
      needs_human: 0.1,
      is_risky: 0.3,
      confidence: 0.88,
    };
    const pol = calibrateToPolicy(p, 12);
    expect(pol.complexity.level).toBe("high");
    expect(pol.complexity.score).toBe(0.7);
    expect(pol.isUrgent.p).toBe(0.2);
    expect(pol.needsPlan.p).toBe(0.9);
    expect(pol.latencyMs).toBe(12);
    expect(pol.complexity.via).toBe("pi-model");
  });
});

describe("calibrateToRisk", () => {
  it("blocks at threshold", () => {
    const p: any = { is_risky: 0.85, confidence: 0.9, complexity_level: "high" };
    expect(calibrateToRisk(p, cfg).block).toBe(true);
    expect(calibrateToRisk({ ...p, is_risky: 0.84 } as any, cfg).block).toBe(false);
  });
});

describe("buildJevInstruction", () => {
  it("contains state and markers", () => {
    const s = buildJevInstruction("audit project");
    expect(s).toContain("audit project");
    expect(s).toContain("jev_calibrate");
    expect(s).toContain("complexity_score");
  });
  it("truncates to 4000", () => {
    const s = buildJevInstruction("a".repeat(5000));
    expect(s.length).toBeLessThan(5000);
  });
});
