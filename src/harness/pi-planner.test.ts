import { describe, it, expect } from "vitest";
import {
  planToDecision,
  buildJevPlanInstruction,
  formatPlanDisplay,
  formatPlanNotify,
} from "./pi-planner.ts";

describe("planToDecision", () => {
  it("maxRisk", () => {
    const d = planToDecision(
      {
        state: "s",
        complexity_level: "high",
        steps: [
          { id: "s1", title: "a", action: "read", risk: 0.2 },
          { id: "s2", title: "b", action: "bash", risk: 0.9 },
        ],
        confidence: 0.8,
      },
      5,
    );
    expect(d.maxRisk).toBe(0.9);
    expect(d.via).toBe("pi-model");
  });
});

describe("formatPlanDisplay", () => {
  it("renders header and steps", () => {
    const p: any = {
      steps: [
        { id: "s1", title: "do thing", action: "read", risk: 0.1 },
        { id: "s2", title: "write thing", action: "write", risk: 0.9, needsHuman: true },
      ],
      confidence: 0.77,
      reasoning: "because",
    };
    const d: any = { maxRisk: 0.9 };
    const out = formatPlanDisplay(p, d);
    expect(out).toContain("Jev Plan");
    expect(out).toContain("s1");
    expect(out).toContain("needs human");
    expect(out).toContain("because");
  });
});

describe("formatPlanNotify", () => {
  it("no withDeps", () => {
    const d: any = { steps: [{ id: "s1", title: "a", action: "bash", risk: 0.3 }], maxRisk: 0.3 };
    expect(formatPlanNotify(d)).toContain("Jev Plan");
  });
});

describe("buildJevPlanInstruction", () => {
  it("contains calibration", () => {
    const s = buildJevPlanInstruction("my state", {
      complexity: { level: "high", score: 0.8 },
      needsPlan: { p: 0.92 },
    });
    expect(s).toContain("my state");
    expect(s).toContain("jev_plan");
  });
});
