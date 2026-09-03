import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const { CLOUD_PROVIDERS, detectCloudFolders, GOOGLE_DRIVE_MOUNT_MARKERS } = await import("../src/helpers/cloudProviders.js");

function loadGeminiSettingsHelpers() {
  const source = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "settings.jsx"), "utf8");
  const match = source.match(/export const DEFAULT_CLOUD_ASR_SETTINGS[\s\S]*?(?=const SettingsPage)/);
  assert.ok(match, "Gemini settings helpers must be exported from settings.jsx");
  return Function(`${match[0].replaceAll("export ", "")}; return { updateGeminiMode, normalizeCloudAsrSettings, cloudAsrTestError };`)();
}

test("Live settings use the supported ASR model instead of a translation model", () => {
  const { updateGeminiMode } = loadGeminiSettingsHelpers();
  assert.equal(updateGeminiMode({}, "live").model, "gemini-3.5-transcribe-live");
});

test("Gemini REST settings use the supported REST ASR model", () => {
  const { updateGeminiMode } = loadGeminiSettingsHelpers();
  assert.equal(updateGeminiMode({}, "rest").model, "gemini-3.5-transcribe");
});

test("old Gemini settings receive REST-compatible defaults", () => {
  const { normalizeCloudAsrSettings } = loadGeminiSettingsHelpers();
  assert.deepEqual(normalizeCloudAsrSettings({ provider: "gemini_transcribe" }), {
    enabled: false,
    provider: "gemini_transcribe",
    api_key: "",
    base_url: "",
    model: "gemini-3.5-transcribe",
    gemini_mode: "rest",
    transcription_mode: "smart",
    language_code: "",
  });
});

test("connection-test errors do not expose API credentials", () => {
  const { cloudAsrTestError } = loadGeminiSettingsHelpers();
  const error = cloudAsrTestError(new Error("request failed for key secret-key"));
  assert.equal(error, "連線測試失敗，請檢查網路與 API 金鑰。");
  assert.ok(!error.includes("secret-key"));
});

test("CLOUD_PROVIDERS has 6 providers each with required fields", () => {
  assert.equal(CLOUD_PROVIDERS.length, 6);
  for (const p of CLOUD_PROVIDERS) {
    assert.ok(p.id, `provider ${p.id} missing id`);
    assert.ok(p.name, `provider ${p.name} missing name`);
    assert.ok(Array.isArray(p.folderCandidates) && p.folderCandidates.length > 0, `provider ${p.id} missing folderCandidates`);
    assert.ok(Array.isArray(p.steps) && p.steps.length >= 3, `provider ${p.id} missing steps`);
    assert.ok(p.downloadUrl && p.downloadUrl.startsWith("https://"), `provider ${p.id} missing downloadUrl`);
  }
});

test("Google Drive mount markers must not include generic 'Google Drive' folder name (prevents false-positive)", () => {
  // 使用者可能自建一個普通資料夾叫 "Google Drive"（例如 E:\Google Drive），
  // 若把它當掛載標記會誤判。掛載磁碟根一定有 My Drive / 我的雲端硬碟 標記。
  assert.ok(!GOOGLE_DRIVE_MOUNT_MARKERS.includes("Google Drive"), "mount markers must not include 'Google Drive'");
  assert.ok(GOOGLE_DRIVE_MOUNT_MARKERS.includes("My Drive"), "mount markers should include 'My Drive'");
  assert.ok(GOOGLE_DRIVE_MOUNT_MARKERS.includes("我的雲端硬碟"), "mount markers should include localized marker");
});

test("detectCloudFolders returns detected:false for non-existent folders", () => {
  const results = detectCloudFolders([{ id: "fake", name: "Fake", folderCandidates: ["__definitely_not_exists__" + Date.now()] }]);
  assert.equal(results.length, 1);
  assert.equal(results[0].detected, false);
  assert.equal(results[0].path, null);
});

test("detectCloudFolders returns objects with id and name", () => {
  const results = detectCloudFolders(CLOUD_PROVIDERS);
  assert.equal(results.length, CLOUD_PROVIDERS.length);
  for (const r of results) {
    assert.ok(r.id);
    assert.ok(r.name);
    assert.equal(typeof r.detected, "boolean");
  }
});
