# Live 即時文字廣播 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 Gemini Live 即時辨識文字在錄音當下顯示於藥丸視窗，不再只停留在主視窗。

**Architecture:** 主進程的 `sendCloudLiveText` 從只發主視窗改為廣播所有存活視窗（沿用 hotkeys.js 既有廣播寫法）；藥丸訂閱既有 `onCloudLiveInterim` / `onCloudLiveFinal` 事件顯示最新 20 字，並用既有 `typeless-start/stop/cancel-recording` 廣播事件清空殘留。頻道名稱與 server 端欄位解析完全不動。

**Tech Stack:** Electron main (Node.js CommonJS), React renderer, node:test + node:assert/strict for tests.

## Global Constraints

- 頻道名稱維持不變：`cloud-live-interim`、`cloud-live-final`、`cloud-live-error`。
- 藥丸最多顯示 20 個字元（含省略號）。
- 單一視窗發送失敗不可影響其他視窗。
- 不新增任何 IPC 頻道；只用 preload 已暴露的 API。
- 廣播寫法沿用 `src/helpers/ipc/hotkeys.js` 既有模式。

---

### Task 1: 廣播 sendCloudLiveText 到所有視窗

**Files:**
- Modify: `src/helpers/ipc/transcription.js:53-57`
- Test: `test/cloud-live-transcript.test.js` (append)

**Interfaces:**
- Consumes: `require("electron").BrowserWindow.getAllWindows()` (default window source; stubbed in tests), `ctx` (unused by this helper, kept for call-site compatibility).
- Produces: `sendCloudLiveText(ctx, channel, value, getWindows)` — exported as `module.exports.sendCloudLiveText`; existing 3-arg call sites keep working via default parameter.

- [ ] **Step 1: Write the failing test**

```js
const assert = require('node:assert/strict');
const test = require('node:test');
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

test("sendCloudLiveText delivers to every live window", () => {
  const received = [];
  const wins = [makeWin(received), makeWin(received), makeWin(received)];
  sendCloudLiveText({}, "cloud-live-interim", "hello", () => wins);
  assert.equal(received.length, 3);
  assert.deepEqual(received[0], ["cloud-live-interim", "hello"]);
});

test("sendCloudLiveText skips destroyed windows and webContents", () => {
  const received = [];
  const wins = [makeWin(received), makeWin(received, { destroyed: true }), makeWin(received, { contentsDestroyed: true })];
  sendCloudLiveText({}, "cloud-live-final", "done", () => wins);
  assert.equal(received.length, 1);
});

test("sendCloudLiveText isolates a failing window", () => {
  const received = [];
  const wins = [makeWin(received, { throwOnSend: true }), makeWin(received)];
  sendCloudLiveText({}, "cloud-live-interim", "hi", () => wins);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], ["cloud-live-interim", "hi"]);
});

test("sendCloudLiveText ignores non-string values", () => {
  const received = [];
  sendCloudLiveText({}, "cloud-live-interim", null, () => [makeWin(received)]);
  sendCloudLiveText({}, "cloud-live-interim", 123, () => [makeWin(received)]);
  assert.equal(received.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cloud-live-transcript.test.js`
Expected: FAIL with "sendCloudLiveText is not a function" (helper not exported yet) or equivalent import error.

- [ ] **Step 3: Write minimal implementation**

```js
function sendCloudLiveText(ctx, channel, value, getWindows) {
  if (typeof value !== "string") return;
  let wins = [];
  try {
    wins = (typeof getWindows === "function" ? getWindows() : require("electron").BrowserWindow.getAllWindows()) || [];
  } catch (_) {
    return;
  }
  for (const w of wins) {
    try {
      if (!w || w.isDestroyed?.()) continue;
      if (!w.webContents || w.webContents.isDestroyed?.()) continue;
      w.webContents.send(channel, value);
    } catch (_) {
      // 單一視窗失敗不影響其他視窗
    }
  }
}
```

And export it next to the existing extra exports at the bottom of `src/helpers/ipc/transcription.js`:

```js
module.exports.sendCloudLiveText = sendCloudLiveText;
```

Keep all existing `sendCloudLiveText(ctx, channel, value)` call sites unchanged (default parameter preserves behavior).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/cloud-live-transcript.test.js`
Expected: PASS (all tests in the file, old + new).

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `node --test test/*.test.js` (from repo root `E:/soda2`, PowerShell: `node --test test/`)
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/helpers/ipc/transcription.js test/cloud-live-transcript.test.js
git commit -m "feat(cloud-live): broadcast interim/final text to all windows"
```

### Task 2: 藥丸顯示即時文字＋停止時清空

**Files:**
- Modify: `src/components/typelessIndicatorLogic.js` (add `truncateLiveText`)
- Modify: `src/components/TypelessIndicator.jsx` (subscribe + render + clear)
- Test: `test/typeless-indicator.test.js` (append)

**Interfaces:**
- Consumes: preload APIs `onCloudLiveInterim`, `onCloudLiveFinal`, `onTypelessStartRecording`, `onTypelessStopRecording`, `onTypelessCancelRecording` (all already exposed; no preload change); `truncateLiveText` from `./typelessIndicatorLogic.js`.
- Produces: `truncateLiveText(text, maxChars = 20)` — string in, display string out. Pill `liveText` state cleared on start/stop/cancel broadcasts.

- [ ] **Step 1: Write the failing test**

```js
import { strict as assert } from "node:assert";
import test from "node:test";
import { truncateLiveText } from "../src/components/typelessIndicatorLogic.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/typeless-indicator.test.js`
Expected: FAIL with "truncateLiveText is not a function" (or import error).

- [ ] **Step 3: Write minimal implementation**

In `src/components/typelessIndicatorLogic.js`, append:

```js
export function truncateLiveText(text, maxChars = 20) {
  const s = typeof text === "string" ? text : "";
  if (s.length <= maxChars) return s;
  return "…" + s.slice(-(maxChars - 1));
}
```

Verify the file already uses ESM `export` syntax (it does: `export function indicatorClass` per existing test import).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/typeless-indicator.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the pill component (no unit test — verified by build + manual test in Task 3)**

In `src/components/TypelessIndicator.jsx`, exact changes:

```jsx
import { indicatorClass, truncateLiveText } from "./typelessIndicatorLogic.js";
```

Add state next to existing `useState` lines:

```jsx
const [liveText, setLiveText] = useState('');
```

Add one `useEffect` after the existing subscription effects (mirror their cleanup style):

```jsx
useEffect(() => {
  const unsubs = [];
  const api = window.electronAPI;
  if (!api) return undefined;
  const reset = () => setLiveText('');
  if (typeof api.onTypelessStartRecording === 'function') unsubs.push(api.onTypelessStartRecording(reset));
  if (typeof api.onTypelessStopRecording === 'function') unsubs.push(api.onTypelessStopRecording(reset));
  if (typeof api.onTypelessCancelRecording === 'function') unsubs.push(api.onTypelessCancelRecording(reset));
  if (typeof api.onCloudLiveInterim === 'function') {
    unsubs.push(api.onCloudLiveInterim((text) => setLiveText(truncateLiveText(text || ''))));
  }
  if (typeof api.onCloudLiveFinal === 'function') {
    unsubs.push(api.onCloudLiveFinal((segment) => setLiveText((prev) => truncateLiveText((prev || '') + (segment || '')))));
  }
  return () => { for (const u of unsubs) { if (typeof u === 'function') u(); } };
}, []);
```

Render the live text under the existing status `<span>`, reusing the pill's text style at smaller size:

```jsx
{liveText ? (
  <span className="text-white/90 font-normal text-[12px] whitespace-nowrap tracking-wide max-w-[220px] overflow-hidden text-ellipsis">
    {liveText}
  </span>
) : null}
```

Place it immediately after the closing `</span>` of the status text block (line 91) and before the `{/* 聲波動畫 */}` comment (line 93).

Do NOT change: existing subscriptions, `indicatorClass` usage, coin/animations, preload (no new APIs needed).

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `node --test test/` from `E:/soda2`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/TypelessIndicator.jsx src/components/typelessIndicatorLogic.js test/typeless-indicator.test.js
git commit -m "feat(pill): show live interim transcription text, clear on stop"
```

### Task 3: 建置＋手動驗證＋重啟 dev

**Files:** none (verification only).

- [ ] **Step 1: Renderer build**

Run: `npm run build:renderer` from `E:/soda2`
Expected: `✓ built` with no errors (chunk-size warnings are pre-existing and OK).

- [ ] **Step 2: Restart dev**

Kill existing dev tree (`concurrently`/`electronmon`/`vite`/soda2 `electron.exe` processes; never touch `llama-server.exe` or unrelated apps), then `npm run dev`, confirm Vite responds 200 on http://localhost:5173 and Electron main window starts.

- [ ] **Step 3: Manual verification (Gemini Live, cloud ASR enabled)**

1. 藥丸開著錄一句話：講話當下藥丸即時冒字（最多 20 字，超出前面截斷加 …）。
2. 主視窗開著錄一句話：完整即時文字照常顯示（回歸）。
3. 按停止：藥丸即時字清空，主視窗即時字清空，最終文字貼到游標（回歸之前修的貼上）。
4. Interim 高頻（~0.5 秒一次）下 UI 不卡頓。

- [ ] **Step 4: Commit the plan doc**

```bash
git add -f docs/superpowers/plans/2026-09-03-live-interim-broadcast.md
git commit -m "docs: live interim broadcast implementation plan"
```

(Note: `docs/superpowers/` is gitignored in this repo; specs have been force-added before, so `-f` matches convention.)
