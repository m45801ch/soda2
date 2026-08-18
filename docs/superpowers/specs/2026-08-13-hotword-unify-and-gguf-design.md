# 統一熱詞來源 + GGUF 套用熱詞 設計文件

日期：2026-08-13
狀態：已批准

## 目標

1. 統一熱詞為單一來源（設定-熱詞，hotwords.txt），AI 風格包熱詞與其即時雙向同步
2. 熱詞在 GGUF 模式（Qwen3-ASR 1.7B）也影響辨識（加入轉錄 prompt）

## 現況

- **設定-熱詞**：HotwordsManager → `getHotwords`/`setHotwords` → sherpaManager → **hotwords.txt**（sherpa ASR 用）
- **風格包熱詞**：AIStylePackManager → **custom_words**（DB）→ 僅編入 AI prompt
- **GGUF 模式**：sherpa 不啟動，llamaManager 不讀 hotwords.txt → 熱詞不影響辨識

## 設計

### 1. GGUF 套用熱詞（src/helpers/llamaManager.js）

`transcribeAudio` 的 payload 中，user text prompt 加入熱詞：
```
Transcribe the audio. Pay attention to these terms: 熱詞1, 熱詞2, ...
```
- 從 hotwords.txt（userData）讀取熱詞（與 sherpaManager.getHotwords 相同格式：每行一個詞，# 註解）
- 無熱詞時維持原 prompt「Transcribe the audio.」

### 2. 統一熱詞來源 + 雙向同步

- **hotwords.txt 是唯一熱詞儲存**
- 同步邏輯（新增 helper `src/helpers/hotwordSync.js`）：
  - `syncHotwordsToCustomWords()`：讀 hotwords.txt → 寫 DB `custom_words`
  - `syncCustomWordsToHotwords()`：讀 DB `custom_words` → 寫 hotwords.txt（透過 sherpaManager.setHotwords）
- 觸發點：
  - 設定-熱詞 `setHotwords` 成功後 → `syncHotwordsToCustomWords`
  - 風格包熱詞變更（AIStylePackManager applySettings）後 → `syncCustomWordsToHotwords`
  - app 啟動時同步一次（main.js）

### 3. 實作位置

- **sherpaManager.setHotwords** 成功後：呼叫 `ctx.databaseManager.setSetting('custom_words', words)`（同步到 custom_words）
- **AIStylePackManager** 熱詞變更：改用 `setHotwords`（寫 hotwords.txt）而非只寫 custom_words
- **llamaManager**：transcribe 讀 hotwords.txt 加入 prompt

### 4. UI

- 風格包熱詞 tab 保留，但與設定-熱詞即時同步（兩邊看到的詞一致）

## 資料流

```
設定-熱詞 新增/刪除 → setHotwords(寫 hotwords.txt) → 同步 custom_words
風格包熱詞 新增/刪除 → setHotwords(寫 hotwords.txt) + 同步 custom_words
GGUF 轉錄 → 讀 hotwords.txt → 熱詞加入 prompt → 優先辨識
sherpa 轉錄 → 讀 hotwords.txt → ASR 熱詞增強（既有）
```

## 錯誤處理
- hotwords.txt 讀寫失敗 → 靜默（不影響辨識）
- 同步失敗 → 靜默（下次同步補齊）

## 測試
- `test/hotword-sync.test.js`：
  - 讀 hotwords.txt → custom_words 同步
  - custom_words → hotwords.txt 同步
  - llamaManager 轉錄 prompt 含熱詞
- 既有 sherpa 熱詞測試保持通過

## 範圍（非目標）
- 不新增熱詞包/分類功能
- 不改變 sherpa 模式的熱詞行為
- 不改變 AI 優化 prompt 的熱詞用法（custom_words 仍編入 AI prompt）
