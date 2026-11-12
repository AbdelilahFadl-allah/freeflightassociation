import { describe, expect, it } from "vitest";
import { csvCell } from "../src/Reports";

describe("CSV export escaping", () => {
  it("quotes delimiters and neutralizes spreadsheet formulas", () => {
    expect(csvCell('A,"B"')).toBe('"A,""B"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("\"'=HYPERLINK(1)\"");
    expect(csvCell(" \t+cmd")).toBe("\"' \t+cmd\"");
  });
});
