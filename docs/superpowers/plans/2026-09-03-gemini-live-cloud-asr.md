# Gemini Live Cloud ASR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Gemini Live microphone transcription to soda2 Cloud ASR with interim text, final-text completion, and a WebSocket connection test.

**Architecture:** PCM capture stays in the renderer; a main-process Gemini client owns the API key and WebSocket. IPC returns only transcript text and sanitized errors. The recording hook chooses this route only for enabled Gemini Transcribe Live settings and reuses existing completion, paste, and history logic.

**Tech Stack:** Electron 31, React 19, Node test runner, `ws`, Gemini Live `BidiGenerateContent`.

## Global Constraints

- Use exactly `gemini-3.5-transcribe-live`; never use the `gemini-3.5-live-translate-preview` translation model.
- Live uses WebSocket `BidiGenerateContent`, never `generateContent`.
- Do not send audio until Gemini returns `setupComplete`.
- Audio is 16-bit PCM, 16 kHz, mono with `audio/pcm;rate=16000`.
- Never expose or log API keys, key-bearing URLs, or raw audio.
- Interim text is display-only; only final text is pasted, processed, and saved.
- Stop, cancel, setup failure, model switch, and unmount must release microphone, timers, listeners, and socket idempotently.
- Preserve local ASR, local streaming, REST Gemini Transcribe, and other Cloud ASR providers.
- Preserve unrelated uncommitted work; stage only task files.

## File Structure

- Modify `package.json`: direct production `ws` dependency.
- Modify `src/helpers/geminiTranscribeLiveClient.js`: handshake, streaming protocol, end/abort lifecycle.
- Modify `src/helpers/ipc/transcription.js`: singleton client, Live connection test, renderer event relay.
- Modify `preload.js`: narrow cloud-live invoke/subscription API without passing settings or key.
- Modify `src/hooks/useRecording.js`: choose IPC Live path; remove renderer client and local precog from that branch.
- Modify `src/App.jsx`: show transcript panel for Cloud Live as well as local streaming.
- Modify `src/settings.jsx`: lock Live selection to the ASR model and display its mode.
- Delete `src/renderer/geminiLiveClient.js`: renderer WebSocket duplicates the secure main-process client.
- Create `test/gemini-transcribe-live-client.test.js` and `test/cloud-live-transcript.test.js`.

### Task 1: Harden the main-process Gemini Live client

**Files:**
- Create: `test/gemini-transcribe-live-client.test.js`
- Modify: `src/helpers/geminiTranscribeLiveClient.js`, `package.json`, `pnpm-lock.yaml`

**Interfaces:** Constructor accepts `{ apiKey, languageCode, transcriptionMode, customVocabulary, logger, WebSocketImpl? }`; it exposes `connect`, `sendAudioChunk`, `endStream`, `disconnect`, and interim/final/error callbacks.

- [ ] **Step 1: Write failing tests**

```js
test('connect waits for setupComplete before resolving', async () => {
  const socket = new FakeSocket();
  const client = new GeminiTranscribeLiveClient({ apiKey: 'test', WebSocketImpl: () => socket });
  const connecting = client.connect();
  socket.open();
  assert.equal(await settles(connecting), false);
  assert.equal(JSON.parse(socket.sent[0]).setup.model, 'models/gemini-3.5-transcribe-live');
  socket.message({ setupComplete: {} });
  await connecting;
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/gemini-transcribe-live-client.test.js`

Expected: FAIL because current connection resolves at socket open and cannot inject a fake socket.

- [ ] **Step 3: Implement minimal behavior**

Inject `WebSocketImpl || require('ws')`; resolve `connect` only from `setupComplete`; reject setup errors, close-before-ready, and timeout. Send the documented setup payload and only permit audio after acknowledgement. `endStream` sends `audioStreamEnd` once and resolves final text on `turnComplete`, close, or bounded timeout. Add direct dependency with `pnpm add ws@^8.18.0`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/gemini-transcribe-live-client.test.js`

Expected: PASS for acknowledgement, audio payload, interim/final split, end, error, and repeated disconnect.

- [ ] **Step 5: Commit**

Run: `git add package.json pnpm-lock.yaml src/helpers/geminiTranscribeLiveClient.js test/gemini-transcribe-live-client.test.js && git commit -m "feat: harden Gemini Live transcription client"`

### Task 2: Expose secure Electron IPC and fix connection testing

**Files:**
- Modify: `src/helpers/ipc/transcription.js`, `preload.js`, `test/gemini-transcribe-live-client.test.js`

**Interfaces:** Renderer can invoke `cloudLiveStart()`, `cloudLiveFeed(audioBase64)`, `cloudLiveEnd()`, and `cloudLiveAbort()`, and subscribe to `onCloudLiveInterim`, `onCloudLiveFinal`, and `onCloudLiveError`. Main reads Cloud settings itself.

- [ ] **Step 1: Write failing tests**

```js
test('Live connection test uses handshake rather than REST transcription', async () => {
  const result = await testCloudAsrConnection({ provider: 'gemini_transcribe', gemini_mode: 'live' });
  assert.deepEqual(result, { success: true });
  assert.equal(restTranscribeCalls, 0);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/gemini-transcribe-live-client.test.js`

Expected: FAIL because the current handler generates a silent WAV and invokes `CloudAsrClient.transcribe` for Live settings.

- [ ] **Step 3: Implement minimal bridge**

Extract testable `isGeminiLiveSettings` and client creation. In `test-cloud-asr-connection`, construct/connect/disconnect the Live client only for Live settings; leave every non-Live silent-WAV REST test unchanged. Let `cloud-live-start` read and validate `cloud_asr_settings` in main. Relay only strings on focused-window channels and sanitize errors. Add preload wrappers with unsubscribe functions.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/gemini-transcribe-live-client.test.js`

Expected: PASS with no REST call for Live mode and matching listener cleanup.

- [ ] **Step 5: Commit**

Run: `git add preload.js src/helpers/ipc/transcription.js test/gemini-transcribe-live-client.test.js && git commit -m "feat: expose secure Gemini Live IPC"`

### Task 3: Stream microphone PCM through IPC and render transcript state

**Files:**
- Create: `test/cloud-live-transcript.test.js`
- Modify: `src/hooks/useRecording.js`, `src/App.jsx`
- Delete: `src/renderer/geminiLiveClient.js`

**Interfaces:** `isGeminiLiveCloudAsr(settings)` selects only an enabled Gemini Live configuration. `appendCloudLiveFinal(finalText, segment)` keeps finalized content while the UI overwrites interim content. `useRecording` returns `partialText` and `fullText`.

- [ ] **Step 1: Write failing tests**

```js
test('only enabled Gemini Transcribe Live settings select Cloud Live', () => {
  assert.equal(isGeminiLiveCloudAsr({ enabled: true, provider: 'gemini_transcribe', gemini_mode: 'live' }), true);
  assert.equal(isGeminiLiveCloudAsr({ enabled: true, provider: 'gemini_transcribe', gemini_mode: 'rest' }), false);
});
test('final text remains when later interim text changes', () => {
  assert.equal(appendCloudLiveFinal('第一句', '第二句'), '第一句第二句');
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/cloud-live-transcript.test.js`

Expected: FAIL because the pure selection and aggregation helpers do not exist.

- [ ] **Step 3: Implement minimal route**

At recording start, resolve the Cloud setting once. For Live, await `cloudLiveStart` before accepting processor audio; resample PCM and send base64 through `cloudLiveFeed`. Subscription callbacks update partial/final state. On stop, call `cloudLiveEnd`, then pass only final text through the existing conversion, dictionary, `window.onTranscriptionComplete`, and `saveTranscription` flow. Cancel/cleanup call abort and unsubscribe. Do not run local precog or instantiate a renderer WebSocket on this branch. Keep `isRecordingRef` semantics. Render the existing transcript panel when either local streaming or Cloud Live has text.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/cloud-live-transcript.test.js test/gemini-transcribe-live-client.test.js`

Expected: PASS; interim is excluded from final aggregate and only the intended settings choose Cloud Live.

- [ ] **Step 5: Commit**

Run: `git add src/hooks/useRecording.js src/App.jsx test/cloud-live-transcript.test.js && git rm src/renderer/geminiLiveClient.js && git commit -m "feat: stream microphone audio to Gemini Live"`

### Task 4: Finish settings contract and regressions

**Files:**
- Modify: `src/settings.jsx`, `test/cloud-providers.test.js`, `test/cloud-live-transcript.test.js`

**Interfaces:** `updateGeminiMode(settings, 'live')` yields `gemini_mode: 'live'` and `model: 'gemini-3.5-transcribe-live'`; REST yields `gemini-3.5-transcribe`.

- [ ] **Step 1: Write failing test**

```js
test('Live settings use the supported ASR model instead of a translation model', () => {
  assert.equal(updateGeminiMode({}, 'live').model, 'gemini-3.5-transcribe-live');
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/cloud-providers.test.js test/cloud-live-transcript.test.js`

Expected: FAIL because the pure settings transition helper does not exist.

- [ ] **Step 3: Implement minimal settings behavior**

Use the helper from the Gemini mode select. Make the Live model field read-only, retain API-key/language/SMART/VERBATIM fields, and preserve backward-compatible defaults for old saved settings. Test failures leave Cloud ASR disabled and show only a sanitized error.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/cloud-providers.test.js test/cloud-live-transcript.test.js test/gemini-transcribe-live-client.test.js && pnpm run lint`

Expected: all named tests pass and lint exits 0.

- [ ] **Step 5: Commit**

Run: `git add src/settings.jsx test/cloud-providers.test.js test/cloud-live-transcript.test.js && git commit -m "feat: configure Gemini Live cloud ASR"`

## Final Verification

- [ ] Run `node --test test/*.test.js`, `pnpm run lint`, and `pnpm run build:renderer`; each exits 0.
- [ ] Manually test setup success, interim text, final paste/history, cancel, network failure, REST Gemini, and local ASR.
- [ ] Run `git diff --check` and inspect `git status --short`; no unrelated files are staged.
