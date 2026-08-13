# AI 優化當日成功次數統計（按廠商）設計文件

日期：2026-08-13
狀態：已批准

## 目標

AI 設定界面顯示「當日各 API 廠商成功輸出次數」，每個廠商分開計數。僅統計成功輸出（有實際模型回應），不計失敗。僅當日（過午夜自動重設）。

## 架構

### 1. 儲存（src/helpers/database.js 新增方法）

設定 key：`ai_daily_usage`，格式 JSON：
```json
{
  "2026-08-13": { "openai": 5, "cerebras": 3 }
}
```

- `incrementAiUsage(providerId)`：今日（YYYY-MM-DD）該廠商計數 +1
- `getAiUsage()`：回傳 `{ today: "2026-08-13", usage: { providerId: count } }`（只含今日，非今日的舊資料略過）

### 2. 計數點（src/helpers/aiTextProcessor.js）

`processTextWithAI(text, mode, customPrompt)` 成功回傳處（`data.choices` 非空，L178-192）呼叫 `this.databaseManager.incrementAiUsage(providerId)`。providerId 是函數內已取得的變數。

### 3. IPC（src/helpers/ipc/ai.js）

`ipcMain.handle("ai-get-usage", ...)` → `databaseManager.getAiUsage()`

### 4. preload

`getAiUsage: () => ipcRenderer.invoke("ai-get-usage")`

### 5. UI（src/settings.jsx AI 分頁頂部）

- 讀取 `ai-get-usage`
- 顯示「今日 AI 優化次數」：列出有次數的廠商 →「OpenAI：5 次」徽章
- 廠商名稱對照 AI_PROVIDERS 的 label；無次數的廠商不顯示

### 6. i18n 三語

- `settings.aiUsageToday`（「今日 AI 優化次數」）
- `settings.aiUsageTimes`（「次」）

## 資料流

```
processTextWithAI 成功 → incrementAiUsage(providerId)
設定頁開啟 → getAiUsage() → 顯示各廠商當日次數
```

## 錯誤處理
- `incrementAiUsage` 讀寫 DB 失敗 → 靜默（不影響 AI 優化功能）
- `getAiUsage` 資料格式錯誤 → 回傳空 usage

## 測試
- `test/ai-usage.test.js`：
  - `incrementAiUsage` 同廠商累加
  - 跨日（模擬不同日期）各自獨立
  - `getAiUsage` 回傳今日正確計數
  - `getAiUsage` 忽略非今日資料

## 範圍（非目標）
- 不統計失敗次數
- 不保留歷史每日記錄（僅當日）
- 不顯示模型層級（只到廠商）
