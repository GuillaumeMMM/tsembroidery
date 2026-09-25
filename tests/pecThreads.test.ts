import { test, expect } from "vitest";
import { getThreadSet } from "../src/index.ts";

test("PEC chart has 65 entries (indices 0-64)", () => {
  const set = getThreadSet();
  expect(set.length).toBe(65);
});

test("PEC chart spot checks (pinned to EmbThreadPec.py)", () => {
  const set = getThreadSet();
  const at = (i: number) => set[i];

  expect(at(0).description).toBe("Unknown");
  expect(at(0).catalog_number).toBe("0");
  expect(at(0).hexColor()).toBe("#000000");

  expect(at(5).description).toBe("Red");
  expect(at(5).catalog_number).toBe("5");
  expect(at(5).hexColor()).toBe("#ed171f");

  expect(at(13).description).toBe("Yellow");
  expect(at(13).hexColor()).toBe("#ffff00");

  expect(at(20).description).toBe("Black");
  expect(at(20).hexColor()).toBe("#000000");

  expect(at(29).description).toBe("White");
  expect(at(29).hexColor()).toBe("#f0f0f0");

  expect(at(64).description).toBe("Applique");
  expect(at(64).catalog_number).toBe("64");
  expect(at(64).hexColor()).toBe("#ffc8c8");
});

test("PEC chart entries carry Brother brand/chart", () => {
  const set = getThreadSet();
  for (const thread of set) {
    expect(thread.brand).toBe("Brother");
    expect(thread.chart).toBe("Brother");
  }
});
