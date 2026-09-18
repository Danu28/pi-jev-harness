import { describe, it, expect, vi } from "vitest";
import { JevCache } from "./cache.ts";

describe("JevCache", () => {
  it("stores and retrieves", () => {
    const c = new JevCache(100_000);
    c.set("foo", 42);
    expect(c.get<number>("foo")).toBe(42);
  });
  it("key truncation 2000", () => {
    const c = new JevCache(100_000);
    const long = "a".repeat(3000);
    c.set(long, "v");
    expect(c.get("a".repeat(2000))).toBe("v");
    expect(c.get(long.slice(0, 2000))).toBe("v");
  });
  it("TTL expiry", async () => {
    vi.useFakeTimers();
    const c = new JevCache(10);
    c.set("k", "v");
    vi.advanceTimersByTime(11);
    expect(c.get("k")).toBeUndefined();
    vi.useRealTimers();
  });
  it("LRU eviction at max", () => {
    const c = new JevCache(100_000, 2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });
  it("clear", () => {
    const c = new JevCache(100_000);
    c.set("x", 1);
    c.clear();
    expect(c.get("x")).toBeUndefined();
  });
});
