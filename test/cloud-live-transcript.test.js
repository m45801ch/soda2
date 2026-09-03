const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function loadCloudLiveHelpers() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'hooks', 'useRecording.js'), 'utf8');
  const match = source.match(/export const isGeminiLiveCloudAsr[\s\S]*?(?=\/\*\*)/);
  assert.ok(match, 'Cloud Live helpers must be exported from useRecording');
  return Function(`${match[0].replaceAll('export ', '')}; return { isGeminiLiveCloudAsr, appendCloudLiveFinal };`)();
}

test('only enabled Gemini Transcribe Live settings select Cloud Live', () => {
  const { isGeminiLiveCloudAsr } = loadCloudLiveHelpers();

  assert.equal(isGeminiLiveCloudAsr({ enabled: true, provider: 'gemini_transcribe', gemini_mode: 'live' }), true);
  assert.equal(isGeminiLiveCloudAsr({ enabled: true, provider: 'gemini_transcribe', gemini_mode: 'rest' }), false);
  assert.equal(isGeminiLiveCloudAsr({ enabled: false, provider: 'gemini_transcribe', gemini_mode: 'live' }), false);
});

test('final text remains when later interim text changes', () => {
  const { appendCloudLiveFinal } = loadCloudLiveHelpers();

  assert.equal(appendCloudLiveFinal('第一句', '第二句'), '第一句第二句');
});
