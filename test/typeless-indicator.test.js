import { strict as assert } from "node:assert";
import test from "node:test";
import { indicatorClass, truncateLiveText } from "../src/components/typelessIndicatorLogic.js";

test("indicatorClass returns pill-recording when nothing special", () => {
  assert.equal(indicatorClass(false, false, false), "pill-recording");
});
test("indicatorClass returns pill-command when commandMode", () => {
  assert.equal(indicatorClass(false, true, true), "pill-command");
});
test("indicatorClass returns pill-ai when aiOptimizeRecording", () => {
  assert.equal(indicatorClass(true, false, false), "pill-ai");
});
test("indicatorClass prioritizes aiOptimizeRecording over commandMode", () => {
  assert.equal(indicatorClass(true, true, true), "pill-ai");
});
test("indicatorClass falls back to pill-cloud when cloudAsr only", () => {
  assert.equal(indicatorClass(false, true, false), "pill-cloud");
});

test("truncateLiveText returns short text unchanged", () => {
  assert.equal(truncateLiveText("你好"), "你好");
  assert.equal(truncateLiveText("12345678901234567890"), "12345678901234567890");
});

test("truncateLiveText keeps the latest 20 chars with ellipsis", () => {
  assert.equal(truncateLiveText("0123456789012345678901234"), "…6789012345678901234");
});

test("truncateLiveText handles empty input", () => {
  assert.equal(truncateLiveText(""), "");
  assert.equal(truncateLiveText(null), "");
});
