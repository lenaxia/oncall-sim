import { describe, it, expect } from "vitest";
import { generateBaseline } from "../../../src/metrics/patterns/baseline";

describe("generateBaseline", () => {
  it("all values equal baselineValue", () => {
    const tAxis = [0, 15, 30, 45, 60];
    const result = generateBaseline(42, tAxis);
    expect(result).toHaveLength(5);
    result.forEach((v) => expect(v).toBe(42));
  });

  it("length matches tAxis length", () => {
    const tAxis = Array.from({ length: 100 }, (_, i) => i * 15);
    expect(generateBaseline(1, tAxis)).toHaveLength(100);
  });

  it("works with zero baseline", () => {
    const result = generateBaseline(0, [0, 15, 30]);
    result.forEach((v) => expect(v).toBe(0));
  });

  it("returns empty array for empty tAxis", () => {
    expect(generateBaseline(10, [])).toHaveLength(0);
  });
});
