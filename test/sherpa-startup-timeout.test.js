const assert = require("node:assert/strict");
const test = require("node:test");

const Module = require("node:module");
const os = require("node:os");
const electronEntry = require.resolve("electron");
require.cache[electronEntry] = {
  id: electronEntry,
  filename: electronEntry,
  loaded: true,
  exports: { app: { isPackaged: false, getPath: () => os.tmpdir() } },
};

const SherpaManager = require("../src/helpers/sherpaManager");

test("getStartupTimeoutMs scales with model size (paraformer 80MB)", () => {
  const manager = new SherpaManager(null, { platform: "win32" });
  // 60s base + 80MB * 100ms = 68s
  assert.equal(manager.getStartupTimeoutMs("paraformer"), 68000);
});

test("getStartupTimeoutMs gives Breeze 1.7GB enough time (not 30s)", () => {
  const manager = new SherpaManager(null, { platform: "win32" });
  // 60s base + 1777MB * 100ms ≈ 238s — 舊寫死 30 秒會在載入到一半 kill 掉後端
  const timeout = manager.getStartupTimeoutMs("breeze_asr_25");
  assert.ok(timeout > 120000, `expected >120s, got ${timeout}ms`);
  assert.equal(timeout, 60000 + Math.ceil(1777 * 100));
});

test("getStartupTimeoutMs falls back to paraformer config for unknown model", () => {
  const manager = new SherpaManager(null, { platform: "win32" });
  assert.equal(manager.getStartupTimeoutMs("no_such_model"), 68000);
  assert.equal(manager.getStartupTimeoutMs(null), 68000);
});
