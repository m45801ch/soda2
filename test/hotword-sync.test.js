import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 從 hotwords.txt 讀取熱詞（與 llamaManager/sherpaManager 相同格式）
function readHotwordsFromFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf8");
  return content.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
}

function buildTranscribePrompt(words) {
  let hint = "";
  if (Array.isArray(words) && words.length) {
    hint = " Pay attention to these terms: " + words.join(", ") + ".";
  }
  return "Transcribe the audio." + hint;
}

test("readHotwordsFromFile parses words and skips comments/blank lines", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hotword-test-"));
  const f = path.join(tmp, "hotwords.txt");
  fs.writeFileSync(f, "# 熱詞列表\nOpenLess\n說打兔\n\n 說打兔 \n", "utf8");
  const words = readHotwordsFromFile(f);
  assert.deepEqual(words, ["OpenLess", "說打兔", "說打兔"]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("readHotwordsFromFile returns [] when file missing", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hotword-test-"));
  const words = readHotwordsFromFile(path.join(tmp, "nope.txt"));
  assert.deepEqual(words, []);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("buildTranscribePrompt includes hotwords when present", () => {
  const p = buildTranscribePrompt(["OpenLess", "說打兔"]);
  assert.ok(p.includes("Pay attention to these terms: OpenLess, 說打兔"));
  assert.ok(p.startsWith("Transcribe the audio."));
});

test("buildTranscribePrompt omits hint when no hotwords", () => {
  assert.equal(buildTranscribePrompt([]), "Transcribe the audio.");
  assert.equal(buildTranscribePrompt(null), "Transcribe the audio.");
});
