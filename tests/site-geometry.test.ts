import { describe, expect, it } from "vitest";
import { validPolygon } from "../src/siteGeometry";

describe("landing polygon validation", () => {
  const square = [{ latitude: 34, longitude: -5 }, { latitude: 34, longitude: -4.99 },
    { latitude: 34.01, longitude: -4.99 }, { latitude: 34.01, longitude: -5 }];
  it("accepts four through seven non-crossing vertices", () => {
    const seven = [{ latitude: 34, longitude: -5 }, { latitude: 34, longitude: -4.997 },
      { latitude: 34, longitude: -4.994 }, { latitude: 34, longitude: -4.99 },
      { latitude: 34.01, longitude: -4.99 }, { latitude: 34.01, longitude: -4.995 },
      { latitude: 34.01, longitude: -5 }];
    expect(validPolygon(square)).toBe(true);
    expect(validPolygon(seven)).toBe(true);
    expect(validPolygon(square.slice(0, 3))).toBe(false);
    expect(validPolygon([...seven, { latitude: 34.005, longitude: -5 }])).toBe(false);
  });
  it("rejects duplicated, crossing, degenerate and invalid coordinates", () => {
    expect(validPolygon([square[0], square[1], square[1], square[3]])).toBe(false);
    expect(validPolygon([square[0], square[2], square[1], square[3]])).toBe(false);
    expect(validPolygon([0, 1, 2, 3].map((n) => ({ latitude: 34, longitude: -5 + n * 0.01 })))).toBe(false);
    expect(validPolygon([{ latitude: 91, longitude: 0 }, ...square.slice(1)])).toBe(false);
  });
});
