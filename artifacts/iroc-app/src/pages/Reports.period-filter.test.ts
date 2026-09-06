import { describe, expect, it } from "vitest";
import {
  buildTopProductComparisonRows,
  dateToPeriodKey,
  filterItemsByPeriod,
  prevPeriodKey,
  sortPeriodKeys,
  type PeriodType,
} from "./Reports";

describe("Reports period filtering", () => {
  it.each([
    ["monthly", "2026-01-15", "Jan 2026", "Dec 2025"],
    ["quarterly", "2026-01-15", "Q1 2026", "Q4 2025"],
    ["halfyearly", "2026-01-15", "H1 2026", "H2 2025"],
    ["yearly", "2026-01-15", "2026", "2025"],
  ] as const)(
    "buckets %s dates and compares with the immediately preceding period",
    (type, date, current, previous) => {
      expect(dateToPeriodKey(date, type)).toBe(current);
      expect(prevPeriodKey(current, type)).toBe(previous);
    },
  );

  it("keeps calendar dates stable even when the source is an ISO timestamp", () => {
    expect(dateToPeriodKey("2026-01-01T00:00:00.000Z", "monthly")).toBe("Jan 2026");
    expect(dateToPeriodKey("2026-12-31T23:59:59.000Z", "yearly")).toBe("2026");
    expect(dateToPeriodKey("2026-02-30", "monthly")).toBe("");
  });

  it.each([
    [
      "monthly",
      ["Jan 2026", "Dec 2025", "Feb 2026"],
      ["Feb 2026", "Jan 2026", "Dec 2025"],
    ],
    [
      "quarterly",
      ["Q4 2025", "Q1 2026", "Q3 2025"],
      ["Q1 2026", "Q4 2025", "Q3 2025"],
    ],
    [
      "halfyearly",
      ["H2 2025", "H1 2026", "H1 2025"],
      ["H1 2026", "H2 2025", "H1 2025"],
    ],
    ["yearly", ["2025", "2027", "2026"], ["2027", "2026", "2025"]],
  ] as const)("sorts %s periods newest first", (type, keys, expected) => {
    expect(sortPeriodKeys([...keys], type)).toEqual(expected);
  });

  it("includes leads created in the selected period and excludes adjacent periods", () => {
    const leads = [
      { id: 1, createdAt: "2026-01-31T23:59:59.000Z" },
      { id: 2, createdAt: "2026-04-01T00:00:00.000Z" },
      { id: 3, createdAt: "2025-12-31T23:59:59.000Z" },
    ];

    const selected = filterItemsByPeriod(
      leads,
      lead => lead.createdAt.slice(0, 10),
      "quarterly",
      "Q1 2026",
    );

    expect(selected.map(lead => lead.id)).toEqual([1]);
  });

  it("uses the same filter contract for all report datasets", () => {
    const rows = [
      { date: "2026-01-01", value: "current" },
      { date: "2025-12-31", value: "previous" },
    ];
    const types: PeriodType[] = ["monthly", "quarterly", "halfyearly", "yearly"];

    for (const type of types) {
      const current = filterItemsByPeriod(rows, row => row.date, type, dateToPeriodKey(rows[0].date, type));
      const previous = filterItemsByPeriod(rows, row => row.date, type, prevPeriodKey(dateToPeriodKey(rows[0].date, type), type));
      expect(current.map(row => row.value)).toEqual(["current"]);
      expect(previous.map(row => row.value)).toEqual(["previous"]);
    }
  });

  it("keeps a product's nonzero values when it is only top-five in the other period", () => {
    const current = [
      { name: "A", qty: 5, revenue: 500, category: "cellenis" },
      { name: "B", qty: 4, revenue: 400, category: "cellenis" },
      { name: "C", qty: 3, revenue: 300, category: "cellenis" },
      { name: "D", qty: 2, revenue: 200, category: "cellenis" },
      { name: "E", qty: 1, revenue: 100, category: "cellenis" },
      { name: "F", qty: 2, revenue: 50, category: "cellenis" },
    ];
    const previous = [
      { name: "F", qty: 9, revenue: 900, category: "cellenis" },
      { name: "A", qty: 4, revenue: 400, category: "cellenis" },
      { name: "B", qty: 3, revenue: 300, category: "cellenis" },
      { name: "C", qty: 2, revenue: 200, category: "cellenis" },
      { name: "D", qty: 1, revenue: 100, category: "cellenis" },
    ];

    const f = buildTopProductComparisonRows(current, previous).find(row => row.name === "F");

    expect(f?.current).toMatchObject({ qty: 2, revenue: 50 });
    expect(f?.previous).toMatchObject({ qty: 9, revenue: 900 });
  });
});