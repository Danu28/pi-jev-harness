import { describe, it, expect } from "vitest";
import { buildCommitMessage, formatStatus, formatLog, formatDiff, formatCommit } from "./pi-git.ts";

describe("buildCommitMessage", () => {
  it("explicit wins", () => {
    expect(buildCommitMessage("state", null, null, " custom ")).toBe("custom");
  });
  it("generates conventional prefix", () => {
    const msg = buildCommitMessage(
      "do audit",
      { complexity: { level: "high", score: 0.8 }, needsPlan: { p: 0.9 } } as any,
      { steps: [{}, {}], maxRisk: 0.3, reasoning: "r" } as any,
    );
    expect(msg).toContain("feat(jev):");
    expect(msg).toContain("via:pi-model");
  });
  it("chore for low", () => {
    const msg = buildCommitMessage(
      "x",
      { complexity: { level: "low", score: 0.2 }, needsPlan: { p: 0.1 } } as any,
      null,
    );
    expect(msg).toContain("chore(jev):");
  });
});

describe("formatStatus", () => {
  it("clean", () => expect(formatStatus("main", "")).toContain("clean"));
  it("lists files", () => {
    const out = formatStatus("main", " M src/index.ts\n?? foo.txt");
    expect(out).toContain("src/index.ts");
  });
});

describe("formatLog", () => {
  it("empty", () => expect(formatLog("")).toContain("no commits"));
  it("formats", () => expect(formatLog("abc1234 first\ndef5678 second")).toContain("abc1234"));
});

describe("formatDiff", () => {
  it("truncates", () => {
    const out = formatDiff("stat", "a".repeat(5000));
    expect(out).toContain("truncated");
  });
});

describe("formatCommit", () => {
  it("short hash", () => {
    expect(formatCommit("abcdef123456", "feat(jev): x", "a\nb")).toContain("abcdef1");
  });
});
