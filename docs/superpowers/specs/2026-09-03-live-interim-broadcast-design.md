# Live 即時文字廣播到所有視窗 設計文件

日期：2026-09-03
狀態：已批准（使用者 2026-09-03 確認）

## 背景

Gemini Live（`gemini-3.5-transcribe-live`）的即時辨識文字只送到主視窗。
錄音時使用者通常在看別的 App，主視窗是藏起來的；看得到的藥丸
（TypelessIndicator）只顯示「錄音中」，沒有接即時文字的線路。
結果：server 每 ~0.5 秒都有回 interim 文字（日誌證實），但使用者講話當下什麼都看不到。

## 目標

講話當下，各可見視窗即時顯示辨識文字；停止後最終文字照現有流程貼到游標（已修復，不動）。

## 架構

`sendCloudLiveText`（`src/helpers/ipc/transcription.js`）目前只 `webContents.send`
給主視窗，改為廣播給所有存活視窗（主視窗、藥丸、控制面板）。
Renderer 各視窗維持各自現有訂閱（`onCloudLiveInterim` / `onCloudLiveFinal`），
由各視窗決定顯示方式。

## 組件

1. **transcription.js `sendCloudLiveText`**：改走 `BrowserWindow.getAllWindows()`，
   跳過已銷毀的 webContents。頻道名稱不變（`cloud-live-interim` /
   `cloud-live-final` / `cloud-live-error`），renderer 零改動即可收到。
2. **TypelessIndicator 藥丸**：新增即時文字顯示，取最新一小段
   （最後 20 個字，超出截斷，超出加 `…`）。訂閱既有
   `onCloudLiveInterim` / `onCloudLiveFinal` 事件。
3. **主視窗 / 控制面板**：維持現有完整顯示（`cloudLivePartialText || cloudLiveFullText`），不改。

## 資料流

```
server interim → onInterimText → 廣播 cloud-live-interim → 各視窗 setPartialText/顯示
server final   → onFinalText   → 廣播 cloud-live-final   → 各視窗累加顯示
停止錄音 → endStream → 最終文字 → onAIOptimizationComplete → safePaste 到游標（既有）
```

## 錯誤處理

- 廣播時跳過 `isDestroyed()` 的視窗；單一視窗發送失敗不影響其他視窗（try/catch 包住）。
- 停止錄音後清空各視窗的即時文字狀態，避免殘留字串。
- 藥丸若沒開著，不影響主流程（fire-and-forget）。

## 測試

1. 開藥丸錄音：講話當下藥丸即時冒字（最後 20 字）。
2. 主視窗開著錄音：完整即時文字照常顯示（回歸）。
3. 停止後：即時字清空，最終文字貼到游標（回歸之前已修的貼上）。
4. interim 頻率（~0.5 秒一次）下 UI 不卡頓。

## 範圍（非目標）

- 不做 Win11 式「游標處逐字跟打」（已決議：面板即時＋游標貼最終）。
- 不改 server 端欄位解析（`interimInputTranscription.text` 已驗證有字）。
- 不改最終文字貼上流程。
