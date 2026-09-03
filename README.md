<div align="center">

<br/>

# 說打兔 soda2

### 用說的，打出來。

**最快的本地語音輸入。按一下熱鍵 → 講 → 文字直接貼到你游標所在的位置。**
**語音辨識除了在你的電腦本地運行，也可選擇雲端模型。**

<img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg" alt="License">
<img src="https://img.shields.io/badge/platform-Windows-0078D6" alt="Platform">
<img src="https://img.shields.io/badge/ASR-sherpa--onnx-orange" alt="ASR">
<img src="https://img.shields.io/badge/100%25-local-success" alt="Local">
<img src="https://img.shields.io/badge/version-1.0.22-brightgreen" alt="Version">

📝 **[更新日誌](CHANGELOG.md)**

</div>

<br/>

> 按一下 **右 Alt / 右 Ctrl**（或自訂 F8–F12）→ 講中文 → 文字**自動貼到你游標所在的位置**。

<br/>

## ✨ 它能做什麼

### 🎙️ 又快又準的本地辨識
- **本地** sherpa-onnx：講完約 **0.3 秒**貼上，可全程離線
- **為中文 / 台灣優化**：簡轉繁用台灣標準字；中英混用（晶晶體）英文保留原文；台灣音「ㄌㄜˋㄙㄜˋ」自動修正為「垃圾」
- **長講邊錄邊算**：錄音中先解碼講完的段落，停止後無論講多長都約 0.2 秒出字
- **防幻聽**：不講話絕不冒出文字，靜音與環境噪音直接拒絕解碼；長音訊自動 VAD 分段
- **熱詞 / 自訂字典**：提升人名、產品、術語等專有名詞的準確度
- **多種模型可選**：Paraformer（預設）、SenseVoice（多語言）、Whisper Small（繁體中文）、Qwen3-ASR（大模型）、Breeze-ASR（台語腔調優化）

### ☁️ 雲端辨識（可選，本地 / 雲端自由切換）

- 不想用本地模型時，可切到**雲端 ASR**：OpenAI（Whisper API）、Groq（Whisper，速度最快）、Deepgram Nova、AssemblyAI、Google Gemini Transcribe（含 Live 即時串流辨識）、或任何相容 OpenAI 格式的服務（Custom）
- **每個服務商各自記錄 API Key**，切換服務商自動換 key、清空模型欄，不會拿錯
- Gemini Live 模式：講話當下藥丸即時顯示辨識文字，停止後自動貼到游標處
- 設定頁一鍵切換回本地，兩邊設定各自保留

### 🧹 乾淨的輸出（純本地規則，不需要 AI）
- **自動標點**：依語意 + 句末語助詞（嗎 → ？、啊 → ！）
- **去口吃贅字**：刪掉「呃、嗯、那個、然後…」，但保留正常疊字（慢慢、謝謝）
- **全形英文 → 半形**：`ｈｅｌｌｏ` → `hello`
- **規則式列點排版**：講「第一…第二…第三…」自動變成 `1. 2. 3.` 清單
- **停頓斷行**：依逐字時間戳在自然換氣處自動換行
- **數字還原（ITN）**：連續中文數字（一二三、二〇二四）自動轉成阿拉伯數字

### ⌨️ 順手的互動
- **一鍵切換錄音**：按一下開始、再按一下停止並貼上；錄音中 `Esc` 取消
- **AI 優化錄音模式**：可設定獨立觸發鍵（右 Alt / 右 Ctrl / F11 / F12），錄音完成自動送 AI 潤飾
- **貼到游標處、不污染剪貼簿**：貼上後自動還原你原本的剪貼簿內容
- **錄音時靜音系統音訊**：避免錄到系統提示音（可選）
- **面板一鍵 AI 開關**：不需要潤飾時直接關掉，省 API

### 🤖 AI 文字優化（可選）
- 接任何**相容 OpenAI** 的服務：DeepSeek / Gemini / OpenAI，或**本地 Ollama（全離線、免 API key）**
- 內建為**台灣口語**調校的 prompt：潤飾、糾錯、整理排版

### 📊 數據與歷史
- **可分享的數據儀表板**：總口述時間、口述字數、節省時間、平均速度
- **每日字數趨勢圖**、**完整歷史**：搜尋、統計、匯出
- **保存錄音檔（可選）**：辨識不滿意可**一鍵重新辨識**；可設定保留期限（7 / 30 / 90 天 / 永久）自動清理

## 🔒 隱私：預設 100% 本地，聲音不外流

語音辨識在**你自己的電腦**跑，**聲音不上傳任何伺服器**。
AI 潤飾也能接**本機的 Ollama / LM Studio**：整條「講話 → 辨識 → 潤稿」都在本地。
你的歷史與錄音存在本機資料庫，與程式碼分開，不會被開源出去。

> 若你手動啟用**雲端辨識**或**雲端 AI 服務**，錄音/文字才會傳送到你指定的服務商（以換取速度或準確度），可隨時一鍵切回全本地。

## 🚀 快速開始

### 一般使用者：下載安裝檔

到 [Releases](https://github.com/m45801ch/soda2/releases) 下載安裝檔，雙擊安裝即可。
不需要 Python / Node，AI 模型已內建，裝完就能用，全程離線。

### 開發者：從原始碼執行（需 **Node.js 18+**、**Python 3.x**）

```bash
git clone https://github.com/m45801ch/soda2.git
cd soda2

# Node 依賴
pnpm install
npx electron-builder install-app-deps

# Python 環境 + sherpa-onnx
python -m venv .venv
.venv/Scripts/python.exe -m pip install sherpa-onnx numpy opencc edge-tts pyinstaller

# 下載模型（離線辨識 + 標點 + 串流 + VAD）
.venv/Scripts/python.exe download_all_models.py

# 啟動
pnpm run dev
```

> 模型檔較大，已在 `.gitignore` 排除，需執行 `download_all_models.py` 下載。

## 🛠️ 技術棧

- **前端**：React 19、Tailwind CSS、Vite ｜ **桌面端**：Electron
- **語音辨識（本地）**：[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)：Paraformer（離線）、Whisper（精準）、SenseVoice、Qwen3-ASR、Breeze-ASR、Silero VAD、ct-transformer（標點）
- **資料庫**：better-sqlite3 ｜ **全域熱鍵**：uiohook-napi ｜ **系統音訊靜音**：napi native addon（native/mute-native）

## 🤝 貢獻

歡迎 issue / PR！這是給中文使用者的工具，你的回饋就是方向。

## 📄 授權

本專案採用 [Apache License 2.0](LICENSE)。
