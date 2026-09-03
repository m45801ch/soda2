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

const { sendCloudLiveText } = require("../src/helpers/ipc/transcription");

function makeWin(received, opts = {}) {
  return {
    isDestroyed: () => !!opts.destroyed,
    webContents: {
      isDestroyed: () => !!opts.contentsDestroyed,
      send: (channel, value) => {
        if (opts.throwOnSend) throw new Error("send failed");
        received.push([channel, value]);
      },
    },
  };
}

test('sendCloudLiveText delivers to every live window', () => {
  const received = [];
  const wins = [makeWin(received), makeWin(received), makeWin(received)];
  sendCloudLiveText({}, "cloud-live-interim", "hello", () => wins);
  assert.equal(received.length, 3);
  assert.deepEqual(received[0], ["cloud-live-interim", "hello"]);
});

test('sendCloudLiveText skips destroyed windows and webContents', () => {
  const received = [];
  const wins = [makeWin(received), makeWin(received, { destroyed: true }), makeWin(received, { contentsDestroyed: true })];
  sendCloudLiveText({}, "cloud-live-final", "done", () => wins);
  assert.equal(received.length, 1);
});

test('sendCloudLiveText isolates a failing window', () => {
  const received = [];
  const wins = [makeWin(received, { throwOnSend: true }), makeWin(received)];
  sendCloudLiveText({}, "cloud-live-interim", "hi", () => wins);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], ["cloud-live-interim", "hi"]);
});

test('sendCloudLiveText ignores non-string values', () => {
  const received = [];
  sendCloudLiveText({}, "cloud-live-interim", null, () => [makeWin(received)]);
  sendCloudLiveText({}, "cloud-live-interim", 123, () => [makeWin(received)]);
  assert.equal(received.length, 0);
});
