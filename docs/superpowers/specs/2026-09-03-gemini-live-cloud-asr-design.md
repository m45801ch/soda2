# Gemini Live 雲端即時 ASR 設計

## 目標

在 soda2 的「設定 → 模型選擇 → 雲端 ASR」提供 Google Gemini 即時語音轉文字。使用者以 API Key 連上 Gemini Live API，開始錄音後持續看見暫時逐字稿；停止錄音後取得正式文字，並沿用現有的文字處理、貼入游標與歷史保存流程。

## 範圍與非目標

- 新增 Gemini 的即時 ASR 路徑；保留既有本地 ASR 與其他雲端 ASR。
- 保留 Gemini 一般轉錄 `gemini-3.5-transcribe` 的「錄完再送」REST 模式。
- 即時模式使用 `gemini-3.5-transcribe-live`，不使用 `gemini-3.5-live-translate-preview`；後者是即時語音翻譯模型，不是本功能的 ASR 模型。
- 不在本功能自動切換到本地模型。使用者可自行切換，以免在網路失敗時發生未預期的辨識來源或隱私行為變更。
- 不新增翻譯、語音輸出、說話者分離或音檔轉錄 UI。

## 使用者流程

1. 使用者在雲端 ASR 選擇 Google Gemini Transcribe，輸入 API Key，選擇「即時串流」及可選的轉錄模式與語言提示。
2. 按下「測試連線」時，程式建立 Gemini Live WebSocket，送出 setup，等待 `setupComplete` 後關閉連線並回報成功。
3. 使用者啟用雲端 ASR，按熱鍵或面板開始錄音。主程序先成功建立 Live 會話，才開始傳送音訊。
4. Renderer 將麥克風音訊轉為 16-bit、16 kHz、單聲道 PCM，以固定短區塊傳給主程序；主程序轉送到 Gemini Live WebSocket。
5. `interimInputTranscription` 只覆蓋畫面的暫時文字；`inputTranscription` 依接收順序累積為正式文字。
6. 停止時傳送 `audioStreamEnd`，等待最後正式文字或明確的會話完成訊號，再把正式文字送進既有完成流程。取消時立即中止會話、停止麥克風並清除畫面文字。

## 架構

```text
Renderer microphone
  → cloud-live IPC (PCM base64)
  → Electron main process Gemini Live client
  → Gemini BidiGenerateContent WebSocket
  → interim/final IPC events
  → renderer transcript state
  → existing completion / text processing / paste / history
```

### 設定契約

`cloud_asr_settings` 持續以 JSON 儲存在既有設定表：

```js
{
  enabled: true,
  provider: 'gemini_transcribe',
  api_key: '...',
  model: 'gemini-3.5-transcribe-live',
  gemini_mode: 'live', // 'rest' | 'live'
  transcription_mode: 'smart', // 'smart' | 'verbatim'
  language_code: '' // 空字串代表自動語言偵測
}
```

當 `provider !== 'gemini_transcribe'` 或 `gemini_mode !== 'live'` 時，既有雲端／本地流程不變。Live 模式的模型名稱由程式固定為 `gemini-3.5-transcribe-live`，避免使用者在模型欄填入不相容的翻譯模型或 REST 模型。

### WebSocket 契約

- 端點：`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`。
- 首個訊息是 `setup`，模型為 `models/gemini-3.5-transcribe-live`，回應模態為 `TEXT`，並帶入 `inputAudioTranscription` 的語言與轉錄設定。
- 必須等待 `setupComplete` 後才允許送出音訊。只在 TCP/WebSocket 的 `open` 事件成功不算通過測試。
- 音訊訊息是 `realtimeInput.audio`，內容為 base64 PCM，`mimeType` 為 `audio/pcm;rate=16000`。
- 停止訊息是 `realtimeInput.audioStreamEnd`。在收齊 server 的 final transcript 與完成訊號前保留會話；若逾時才以已收集的 final 文字結束。

## 錯誤與資源管理

- API Key 缺漏、setup 拒絕、WebSocket 斷線或 IPC 失敗時，停止錄音並顯示可理解的錯誤；不得留下麥克風 track、AudioContext、計時器或 WebSocket。
- 快速開始後停止、取消、切換 ASR、視窗卸載與程式結束都必須是安全且可重複呼叫的清理操作。
- 日誌只記錄錯誤類型與模型，不得輸出 API Key、含 key 的 WebSocket URL 或原始音訊。
- 正式文字只保存一次；interim 文字不得進入剪貼簿、歷史或文字後處理。

## 驗收標準

- 在 Gemini Live 模式按下測試連線，不會送出 `generateContent`；收到 `setupComplete` 才顯示成功。
- 說話時介面持續顯示 Gemini 的暫時文字；句段完成後暫時文字不重複地成為正式文字。
- 停止後，所有正式文字按原順序經既有處理後貼入目前游標，並保存至歷史。
- 取消或連線錯誤不貼上、不保存文字，且麥克風與 WebSocket 已關閉。
- REST Gemini、其他雲端供應商與本地 ASR 的既有行為與測試不受影響。

## 驗證策略

- 為 Gemini Live client 寫單元測試：setup 模型與 payload、等待 `setupComplete`、interim/final 分流、結束與逾時、錯誤及 idempotent disconnect。
- 為 IPC 寫測試：未連線不可 feed、主程序正確轉送 renderer event、abort 與 end 都清理 client。
- 為 renderer 串流選擇邏輯寫測試：只有啟用的 Gemini Live 設定走雲端 PCM 路徑；正式／暫時文字正確合併。
- 手動驗證：有效 key 的連線測試、短句與長句、快速開始後取消、拔除網路、切回本地模型。
