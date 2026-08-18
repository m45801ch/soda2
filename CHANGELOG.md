# Changelog

本專案版本變更紀錄。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，
版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

- （暫無）

## [1.2.3] - 2026-08-18

### 新增

- 中文序數轉數字預設改為開啟：講「版本號為 V 一點二點三」→「V 1.2.3」，支援版本號/連續小數點轉換（一點二點三 → 1.2.3），GGUF 與 sherpa 兩路徑皆生效
- 熱詞統一為單一來源（設定-熱詞），與 AI 風格包熱詞即時雙向同步
- 熱詞在 GGUF 模式（Qwen3-ASR 1.7B）也影響辨識（加入轉錄 prompt）
- 熱詞新增/刪除不再依賴 sherpa server（GGUF 模式也能管理）
- AI 設定頁新增「今日 AI 優化成功次數」（按廠商分開計數）
- AI 設定填入 API Key 後自動重整模型清單
- AI 連線測試新增 HTTP 402 明確錯誤提示（Cerebras 等需付款帳號）

### 修正

- 修復語音符號誤觸發：常見字（如「車」「火」）不再被自動替換成符號，需「名稱＋表情/符號」後綴才觸發
- 修復熱詞「Sherpa 服務器未就緒」問題（GGUF 模式）

## [1.2.2] - 2026-08-13

### 修正

- 修復語音符號誤觸發：講到常見字（如「車」「火」）會被自動替換成符號。改為需「名稱＋表情/符號/emoji」後綴才觸發（與 sherpa 內建行為一致），例如「汽車表情」→🚗、「句號符號」→。

## [1.2.1] - 2026-08-13

### 修正

- 修復打包版麥克風靜音問題（錄音錄到靜音、無文字輸出、音量測試無反應）：根因為第三方防毒軟體（Avast）攔截新 exe 的麥克風存取，非程式 bug。恢復 Chromium 默認權限處理（移除 media 權限攔截）
- 新增錄音裝置與 getUserMedia / AudioContext / 採集峰值診斷日誌，方便日後排查麥克風問題

## [1.2.0] - 2026-08-12

### 新增

- AI 優化錄音金幣煙火動畫：畫面正下方的橢圓形膠囊（TypeLess 指示器）與右下角 mini-capsule 在 AI 優化錄音時顯示金色金幣煙火動畫
- AI 優化錄音專屬音效：設定頁「音效」區新增「AI 優化錄音音效」子區塊（獨立開關 / 主題 / 音量 / 試聽），啟動與停止都用專屬音效
- 備份與還原：新增設定分頁，可一鍵匯出所有自訂資料（主 prompt、修飾模式、專業詞庫、熱詞、字典、設定）為單一 JSON；支援可選範圍還原
- 雲端同步資料夾備份：自動偵測本機雲端同步資料夾（OneDrive / Google Drive / Dropbox / Box / iCloud / Nextcloud），可設定引導安裝、立即備份到雲端、每日自動備份
- AI 模型商「取得 API Key」連結：設定頁選擇模型商後可一鍵開啟該模型的 API key 取得頁面
- 歷史記錄「匯出文字」按鈕實作（原本為 TODO）：可匯出所有記錄為 txt / csv

### 修正

- 修復 AI 優化錄音啟動音被截斷的問題（錄音時靜音系統音訊前先等音效播完）
- 修復 Qwen3-ASR 1.7B 英文專有名詞（如 Google）被誤辨識成中文音譯（改善 transcribe system prompt）
- 修復 GGUF 模式下語音符號（內建符號表與 apply_emoji）不生效（新增 JS 版語音符號）
- 修復開發時測試殘留暫存檔塞爆 C 槽的問題（測試結束自動清理）
- 移除 AI 風格包內重複的「備份與還原」tab（由新備份分頁取代）
- 移除 AWS Bedrock 模型商（無免費額度）
- 移除設定頁「快捷錄音」說明區塊
- 共用工具改 ESM 防止 Vite dev server 因 .cjs import 崩潰

## [1.1.0] - 2026-08-10

### 新增

- Qwen3-ASR 1.7B (GGUF) 模型支援：新增 llama.cpp 引擎（llama-server），支援下載 GGUF 模型並以常駐 HTTP 服務執行語音辨識，含 CUDA GPU 加速
- ASR 加速模式設定：一般設定新增「加速模式」下拉（自動 / CPU / GPU），同時控制 sherpa 與 llama 兩引擎的加速方式
- 中文序數轉數字開關：講「一點一、一點二」或「一、二、三」時自動轉成 1.1、1.2 或 1. 2. 3. 格式

### 修正

- 修復 sherpa-onnx 無法從含中文路徑載入模型的問題（改以 8.3 短檔名轉換）
- 修復模型下載 EPERM 問題（改寫入 .part 暫存檔再 rename）
- 修復部分下載殘留被誤判為完整檔案的問題

## [1.0.22] - 2026-08-08

### 新增

- 主視窗尺寸自癒：透明無框視窗被 Windows 縮成怪尺寸（216×214、掛到螢幕外）時自動矯正回 472×470（issue #22）
- 網頁縮放防護：強制 100% 縮放並擋掉 Ctrl+滾輪誤觸縮放（永不還原的版面擠爛問題）
- 保存錄音檔開關 + 錄音保留期限（7 / 30 / 90 天 / 永久）：關掉不寫磁碟省 SSD，超過期限開機自動清除
  「台灣音「ㄌㄜˋㄙㄜㄨㄝ」→ 垃圾」修正（issue #21）：Paraformer 聽成樂色/勒色時內建修正
- 阿拉伯數字還原：連續 3 個以上中文數字（一二三→123、二〇二四→2024）自動轉阿拉伯數字
- 熱詞功能修正：set_hotwords 改用巢狀 config，熱詞終於寫得進 hotwords.txt（PR #20 yhlhenry）
- macOS 操作模式支援：語音翻譯 / 簡繁轉換 / 按鍵指令的快速鍵改用 osascript System Events
- Mac 觸發鍵下拉改 Mac-aware：顯示「右 Option（預設）」，不再列出 Mac 上不存在的右 Ctrl

### 修正

- 改錯候選浮窗：自訂輸入框移到最上方 + autoFocus，建議清單可捲動，再多也不撑爆視窗（issue #19）
- 深色模式下歷史區文字改用淺色，不再黑底黑字
- TypeLess 指示器改 showInactive：錄音中不再搶走前景 app 焦點（PR #23）
- 關於頁顯示真實版本號，不再銅定 v1.0.1（issue #15）

## [1.0.20][1.0.19][1.0.18][1.0.17][1.0.16][1.0.15] - 2026-08-07

自 v1.0.15 起的多個版本在互聯授權樹上合併；本版本整合以下功能：

### 新增（截至 v1.0.20）
- 主視窗尺寸自癒（每藏/顯示被咬縮 + 雙螢幕 DPI 縮 var，293×214 版面全爛無法自救）（issue #22）
- 縮放防護：主面板強制 100%
- 保存錄音檔開關 + 錄音保留期限（建議 1）
- 熱詞修復（巢狀 config，PR #20）
- Mac 前景焦點不搶走（showInactive，PR #23）

### 歷史版本
See [releases](https://github.com/Jeffrey0117/SpeakSlow/releases)。

## [1.0.14] - 2026-07-xx

### 新增
- 停頓自動分行改可開關（issue #17，預設關）
- 一鍵清空辨識紀錄（issue #10）

### 修正
- 移除 Windows/Linux 預設選單列，避免 Alt 誤觸啟動選單吃掉右 Alt keyup
- Mac 視窗叫回 / 退出無反應修正

## [1.0.13] - 2026-07-xx

### 變更
- 自動列點（第一二三→ 1. 2. 3.）改預設關閉 + 增加設定開關
- 修正 Mac dock 叫不回視窗、按結束沒反應（issue #16）

## [1.0.12] - 2026-07-xx

### 新增
- 串流模型自動下載捃及 Windows / Linux（不再限定 macOS）
- 麥風風音量測試條（搭配麥風風選擇）
- 可自訂 typeless 錄音觸發鍵（issue #12）

## [1.0.11] - 2026-07-xx

### 新增
- 採用 PR #3（webeasyplay）的 Mac 後端載入與焦點貼上修正（手動移植）
- 三平台下載改用永久（latest/download）

## [1.0.10] - 2026-07-xx

### 新增
- 符號管理頁（看內建 + 自訂觸發詞，存 DB 即時生效）

### 修正
- 簡轉繁「帳都→ 賬號」的台灣標準字修正（opencc s2tw 認賬不認帳）
- 迷你模式錄音/處理錯誤改走膠囊通知，不再冒大 toast
- Mac 沒有輔助使用權限就啟動全域熱鍵 crash-loop → 先檢查再啟動
- Mac/Linux 也改固定檔名

## [1.0.9] - 2026-07-xx

### 新增
- 麥克風選擇 + 自動增益（AGC）開關
- 切換 AI 供應商時清空 api_key（避免帶著別家的 key 打壞）

## [1.0.8] - 2026-07-xx

### 修正
- Gemini 模型清單更新為現役模型（移除已停用的 2.0-flash / 1.5-pro）
- 全面更新模型清單為現役 + 設定充值

## [1.0.7] - 2026-07-xx

### 修正
- SRT 字幕用逐字時間戳把長段切短字幕（不再一句長達十幾秒）
- 主面板標題擠到直排換行的視覺修正、爬浮動 toast

## [1.0.6] - 2026-06-xx

### 新增
- 逐字稿 / 影片 / SRT 字幕功能

### 修正
- 右 Ctrl / 右 Alt 漏接 keyup 會永久卡死 toggle → 無法停止錄音

## [1.0.5] 2026-06-xx

### 新增
- PyInstaller 將 edge-tts（+ aiohttp / certifi）打包進後端

## [1.0.1] - 2026-05-xx

### 修正
- transcribe 卡在 Python 檢查（即使已內建後端）— 改為依賴後端是否存在

## [1.0.0] - 2026-05-xx

### 新增
- 使用 sherpa-onnx 的本地語音輸入（Paraformer 即時辨識）
- 聲聲慢 / 說打兔 基礎 UI：主面板、迷你模式、操作模式
- AI 文字優化：連結 OpenAI 相容服務（DeepSeek / Gemini / Ollama）
- 語音符號與表情插入
- 錄音熱鍵：右 Alt / 右 Ctrl 一鍵切換錄音

[unreleased]: https://github.com/m45801ch/soda2/compare/v1.2.3...HEAD
[1.2.3]: https://github.com/m45801ch/soda2/releases/tag/v1.2.3
[1.2.2]: https://github.com/m45801ch/soda2/releases/tag/v1.2.2
[1.2.1]: https://github.com/m45801ch/soda2/releases/tag/v1.2.1
[1.2.0]: https://github.com/m45801ch/soda2/releases/tag/v1.2.0
[1.1.0]: https://github.com/m45801ch/soda2/releases/tag/v1.1.0
[1.0.22]: https://github.com/m45801ch/soda2/releases/tag/v1.0.22
[1.0.14]: https://github.com/Jeffrey0117/SpeakSlow/releases/tag/v1.0.14
[1.0.13]: https://github.com/Jeffrey0117/SpeakSlow/releases/tag/v1.0.13
[1.0.12]: https://github.com/Jeffrey0117/SpeakSlow/releases/tag/v1.0.12
[1.0.11]: https://github.com/Jeffrey0117/SpeakSlow/releases/tag/v1.0.11
[1.0.10]: https://github.com/Jeffrey0117/SpeakSlow/releases/tag/v1.0.10
[1.0.9]: https://github.com/Jeffrey0117/SpeakSlow/releases/tag/v1.0.9
[1.0.8]: https://github.com/Jeffrey0117/SpeakSlow/releases/tag/v1.0.8
[1.0.7]: https://github.com/Jeffrey0117/SpeakSlow/releases/tag/v1.0.7
[1.0.6]: https://github.com/Jeffrey0117/SpeakSlow/releases/tag/v1.0.6
[1.0.5]: https://github.com/Jeffrey0117/SpeakSlow/releases/tag/v1.0.5
[1.0.1]: https://github.com/Jeffrey0117/SpeakSlow/releases/tag/v1.0.1
[1.0.0]: https://github.com/Jeffrey0117/SpeakSlow/releases/tag/v1.0.0