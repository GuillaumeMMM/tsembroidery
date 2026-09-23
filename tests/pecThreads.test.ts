import { test } from "node:test";
import assert from "node:assert/strict";
import { getThreadSet } from "../dist/index.js";

test("PEC chart has 65 entries (indices 0-64)", () => {
  const set = getThreadSet();
  assert.equal(set.length, 65);
});

test("PEC chart spot checks (pinned to EmbThreadPec.py)", () => {
  const set = getThreadSet();
  const at = (i: number) => set[i];

  assert.equal(at(0).description, "Unknown");
  assert.equal(at(0).catalog_number, "0");
  assert.equal(at(0).hexColor(), "#000000");

  assert.equal(at(5).description, "Red");
  assert.equal(at(5).catalog_number, "5");
  assert.equal(at(5).hexColor(), "#ed171f"); // 237,23,31

  assert.equal(at(13).description, "Yellow");
  assert.equal(at(13).hexColor(), "#ffff00"); // 255,255,0

  assert.equal(at(20).description, "Black");
  assert.equal(at(20).hexColor(), "#000000");

  assert.equal(at(29).description, "White");
  assert.equal(at(29).hexColor(), "#f0f0f0"); // 240,240,240

  assert.equal(at(64).description, "Applique");
  assert.equal(at(64).catalog_number, "64");
  assert.equal(at(64).hexColor(), "#ffc8c8"); // 255,200,200
});

test("PEC chart entries carry Brother brand/chart", () => {
  const set = getThreadSet();
  for (const thread of set) {
    assert.equal(thread.brand, "Brother");
    assert.equal(thread.chart, "Brother");
  }
});
