const { ipcMain } = require("electron");
const { runVoiceCommand } = require("../commandMode");
const recovery = require("../recovery");

function isGgufModel(ctx) {
  return (ctx.databaseManager ? ctx.databaseManager.getSetting("asr_model_type", "paraformer") : "paraformer") === "qwen3_asr_gguf";
}

function getCloudAsrSettings(ctx) {
  const saved = ctx.databaseManager?.getSetting("cloud_asr_settings", null);
  let settings = null;
  if (typeof saved === "string") {
    try {
      settings = JSON.parse(saved);
    } catch (_) {
      return null;
    }
  } else if (saved && typeof saved === "object") {
    settings = saved;
  }
  if (!settings) return null;
  // 各服務商各自記 key（API 金鑰欄已改為 per-provider）；舊版共用欄位當 fallback
  const perProviderKey = settings.api_keys && typeof settings.api_keys === "object"
    ? settings.api_keys[settings.provider]
    : "";
  return { ...settings, api_key: perProviderKey || settings.api_key || "" };
}

function isGeminiLiveSettings(settings) {
  return settings?.provider === "gemini_transcribe" && settings?.gemini_mode === "live";
}

function createGeminiLiveClient(ctx, settings) {
  const GeminiTranscribeLiveClient = require("../geminiTranscribeLiveClient");
  return new GeminiTranscribeLiveClient({
    apiKey: settings.api_key,
    languageCode: settings.language_code || "",
    transcriptionMode: settings.transcription_mode || "smart",
    customVocabulary: settings.custom_vocabulary || [],
    logger: ctx.logger,
  });
}

function safeErrorMessage(error, fallback = "Gemini Live operation failed") {
  const message = typeof error?.message === "string" ? error.message : fallback;
  return message
    .replace(/AIza[\w-]+/g, "[redacted]")
    .replace(/((?:api[_ -]?key|key)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]");
}

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

module.exports = function register(ctx) {
  // 打開「記下來」的筆記檔（用系統預設程式）
  ipcMain.handle("open-notes", async () => {
    try {
      const { app, shell } = require("electron");
      const fs = require("fs");
      const p = require("path").join(app.getPath("userData"), "soda2-notes.md");
      if (!fs.existsSync(p)) fs.writeFileSync(p, "# 說打兔筆記\n", "utf8");
      await shell.openPath(p);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 崩潰救援：錄音中持續把音訊寫到暫存檔，中斷時下次開機可救回
  ipcMain.handle("recovery-begin", async () => recovery.begin());
  ipcMain.handle("recovery-append", async (_e, b64) => recovery.append(b64));
  ipcMain.handle("recovery-end", async () => recovery.end());

  // 點字改錯：給「選取的那段」3~5 個依上下文的正確候選（走 AI，本地 Ollama 免費）
  ipcMain.handle("suggest-corrections", async (_event, sentence, target) => {
    try {
      if (!ctx.aiProcessor) return { success: false, error: "AI 未設定" };
      const t = (target || "").trim();
      if (!t) return { success: false, error: "沒有選取文字" };
      const prompt =
        "這是一段語音辨識結果，可能有同音字或聽錯的詞。\n" +
        "句子：「" + (sentence || t) + "」\n" +
        "其中「" + t + "」這部分使用者覺得可能辨識錯了。\n" +
        "請依上下文，給 3~5 個最可能的「正確」候選（可含原樣），用 JSON 字串陣列輸出，" +
        "例如 [\"申請\",\"深圳\"]。只輸出 JSON 陣列，不要任何其他文字。";
      const res = await ctx.aiProcessor.processTextWithAI(t, "correct", prompt);
      if (!res || !res.success || typeof res.text !== "string") {
        return { success: false, error: (res && res.error) || "取得候選失敗" };
      }
      let arr = [];
      try {
        const m = res.text.match(/\[[\s\S]*\]/);
        arr = m ? JSON.parse(m[0]) : [];
      } catch (e) { arr = []; }
      arr = (Array.isArray(arr) ? arr : [])
        .filter((x) => typeof x === "string" && x.trim())
        .map((x) => x.trim())
        .slice(0, 6);
      // 本地 qwen 常吐簡體 → 統一轉繁體（與操作模式 AI 一致；text_transform 是純 opencc）
      if (arr.length && ctx.sherpaManager?.transformText) {
        try {
          const conv = await ctx.sherpaManager.transformText(arr.join("\n"), "to_traditional");
          if (conv && conv.success && typeof conv.text === "string") {
            const lines = conv.text.split("\n").map((s) => s.trim()).filter(Boolean);
            if (lines.length === arr.length) arr = lines;
          }
        } catch (e) { /* 轉換失敗就用原文 */ }
      }
      return { success: true, suggestions: arr };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 操作模式：把一段辨識文字當指令派發（比對到才執行，否則回 matched:false）
  ipcMain.handle("run-voice-command", async (_event, text) => {
    try {
      return await runVoiceCommand(ctx, text);
    } catch (error) {
      return { matched: false, success: false, error: error.message };
    }
  });

  // 录音相关
  ipcMain.handle("start-recording", async () => {
    // TODO: 实现录音开始功能
    return { success: true };
  });

  ipcMain.handle("stop-recording", async () => {
    // TODO: 实现录音停止功能
    return { success: true };
  });

  // Sherpa ASR 相关
  ipcMain.handle("check-sherpa-status", async () => {
    console.log("[IPC] check-sherpa-status 被調用, serverReady:", ctx.sherpaManager.serverReady);
    const status = await ctx.sherpaManager.checkStatus();
    console.log("[IPC] check-sherpa-status 返回:", JSON.stringify(status));
    return {
      ...status,
      server_ready: ctx.sherpaManager.serverReady
    };
  });

  ipcMain.handle("sherpa-status", async () => {
    return await ctx.sherpaManager.checkStatus();
  });

  // 模型文件管理
  ipcMain.handle("check-model-files", async () => {
    const result = isGgufModel(ctx)
      ? await ctx.llamaManager.checkModelFiles()
      : await ctx.sherpaManager.checkModelFiles();
    const serverStatus = isGgufModel(ctx)
      ? {
          server_ready: ctx.llamaManager.serverReady,
          models_initialized: ctx.llamaManager.serverReady,
          server_process_running: ctx.llamaManager.serverProcess !== null,
        }
      : {
          server_ready: ctx.sherpaManager.serverReady,
          models_initialized: ctx.sherpaManager.modelsInitialized,
          server_process_running: ctx.sherpaManager.serverProcess !== null,
        };
    return { ...result, ...serverStatus };
  });

  ipcMain.handle("get-download-progress", async () => {
    return isGgufModel(ctx)
      ? await ctx.llamaManager.getDownloadProgress()
      : await ctx.sherpaManager.getDownloadProgress();
  });

  ipcMain.handle("download-models", async (event) => {
    if (isGgufModel(ctx)) {
      await ctx.llamaManager.ensureLlamaBinary((progress) => {
        event.sender.send("model-download-progress", progress);
      });
      return await ctx.llamaManager.ensureModelAvailable((progress) => {
        event.sender.send("model-download-progress", progress);
      });
    }
    return await ctx.sherpaManager.downloadModels((progress) => {
      event.sender.send("model-download-progress", progress);
    });
  });

  // 音频转录相关
  ipcMain.handle("transcribe-audio", async (event, audioData, options) => {
    if (isGgufModel(ctx)) {
      return await ctx.llamaManager.transcribeAudio(audioData, options);
    }
    return await ctx.sherpaManager.transcribeAudio(audioData, options);
  });

  // 測試雲端 ASR 連線
  ipcMain.handle("test-cloud-asr-connection", async () => {
    try {
      const cloudAsrSettings = getCloudAsrSettings(ctx);
      if (!cloudAsrSettings) return { success: false, error: "Cloud ASR settings are not configured" };
      if (isGeminiLiveSettings(cloudAsrSettings)) {
        const client = createGeminiLiveClient(ctx, cloudAsrSettings);
        try {
          await client.connect();
          return { success: true };
        } finally {
          client.disconnect();
        }
      }
      const CloudAsrClient = require("../cloudAsrClient");
      const sampleRate = 16000;
      const numChannels = 1;
      const bitsPerSample = 16;
      const numSamples = sampleRate / 2; // 0.5s
      const dataSize = numSamples * (bitsPerSample / 8) * numChannels;
      const fileSize = 36 + dataSize;
      
      const wavHeader = Buffer.alloc(44);
      wavHeader.write("RIFF", 0);
      wavHeader.writeUInt32LE(fileSize, 4);
      wavHeader.write("WAVE", 8);
      wavHeader.write("fmt ", 12);
      wavHeader.writeUInt32LE(16, 16);
      wavHeader.writeUInt16LE(1, 20); // PCM
      wavHeader.writeUInt16LE(numChannels, 22);
      wavHeader.writeUInt32LE(sampleRate, 24);
      wavHeader.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
      wavHeader.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
      wavHeader.writeUInt16LE(bitsPerSample, 34);
      wavHeader.write("data", 36);
      wavHeader.writeUInt32LE(dataSize, 40);
      
      const silence = Buffer.alloc(dataSize);
      const audioBuffer = Buffer.concat([wavHeader, silence]);
      
      const resultText = await CloudAsrClient.transcribe(cloudAsrSettings, audioBuffer);
      return { success: true, text: resultText };
    } catch (error) {
      return { success: false, error: safeErrorMessage(error, "Cloud ASR connection test failed") };
    }
  });

  // 邊錄邊算（precog）：錄音中把已閉合語音段先解碼，停止時只剩尾段
  ipcMain.handle("precog-start", async (event, profile) => {
    try {
      return await ctx.sherpaManager.precogStart(profile);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("precog-feed", async (event, audioB64) => {
    try {
      return await ctx.sherpaManager.precogFeed(audioB64);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("precog-abort", async () => {
    try {
      return await ctx.sherpaManager.precogAbort();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 串流辨識 API (Zipformer Transducer)
  ipcMain.handle("streaming-start", async (event, options = {}) => {
    try {
      return await ctx.sherpaManager.streamingStart(options);
    } catch (error) {
      ctx.logger.error("串流辨識啟動失敗:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("streaming-feed", async (event, audioChunk, isFinal = false) => {
    try {
      return await ctx.sherpaManager.streamingFeed(audioChunk, isFinal);
    } catch (error) {
      ctx.logger.error("串流辨識送入音訊失敗:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("streaming-end", async () => {
    try {
      return await ctx.sherpaManager.streamingEnd();
    } catch (error) {
      ctx.logger.error("串流辨識結束失敗:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("preload-streaming-model", async () => {
    try {
      return await ctx.sherpaManager.preloadStreamingModel();
    } catch (error) {
      ctx.logger.error("預載串流模型失敗:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("check-streaming-model-files", async () => {
    try {
      return await ctx.sherpaManager.checkStreamingModelFiles();
    } catch (error) {
      ctx.logger.error("檢查串流模型失敗:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("download-streaming-model", async (event) => {
    try {
      return await ctx.sherpaManager.downloadStreamingModel((progress) => {
        event.sender.send("streaming-model-download-progress", progress);
      });
    } catch (error) {
      ctx.logger.error("下載串流模型失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 重新辨識：用保存的原始錄音重跑，更新該筆文字
  ipcMain.handle("retranscribe-transcription", async (event, id, options = {}) => {
    try {
      const record = ctx.databaseManager.getTranscriptionById(id);
      if (!record) return { success: false, error: "找不到該筆紀錄" };
      if (!record.audio_path) {
        return { success: false, error: "這筆沒有保存錄音檔（舊資料無法重辨）" };
      }
      const fs = require("fs");
      if (!fs.existsSync(record.audio_path)) {
        return { success: false, error: "錄音檔已不存在" };
      }
      const ordinalSetting = ctx.databaseManager ? ctx.databaseManager.getSetting("convert_ordinal_numbers", false) : false;
      const opts = { ...options, convert_ordinal_numbers: ordinalSetting };
      const result = isGgufModel(ctx)
        ? await ctx.llamaManager.transcribeFilePath(record.audio_path, opts)
        : await ctx.sherpaManager.transcribeFilePath(record.audio_path, opts);
      if (!result || !result.success) {
        return { success: false, error: result?.error || "辨識失敗" };
      }
      ctx.databaseManager.updateTranscriptionText(id, result.text, null);
      return { success: true, text: result.text };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ===== 熱詞功能 =====
  ipcMain.handle("get-hotwords", async () => {
    try {
      return await ctx.sherpaManager.getHotwords();
    } catch (error) {
      ctx.logger.error("取得熱詞設定失敗:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("set-hotwords", async (event, config) => {
    try {
      // config: { enabled: boolean, score: number, words: string[] }
      return await ctx.sherpaManager.setHotwords(config);
    } catch (error) {
      ctx.logger.error("設定熱詞失敗:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("add-hotword", async (event, word) => {
    try {
      return await ctx.sherpaManager.addHotword(word);
    } catch (error) {
      ctx.logger.error("新增熱詞失敗:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("remove-hotword", async (event, word) => {
    try {
      return await ctx.sherpaManager.removeHotword(word);
    } catch (error) {
      ctx.logger.error("刪除熱詞失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 模型管理 - 更新为实际功能
  ipcMain.handle("download-model", async (event, modelName) => {
    // 使用统一的模型下载功能
    return await ctx.sherpaManager.downloadModels((progress) => {
      event.sender.send("model-download-progress", progress);
    });
  });

  ipcMain.handle("get-available-models", () => {
    // 返回 Sherpa 支持的模型列表
    return {
      models: [
        {
          name: "sherpa-onnx-paraformer-zh",
          displayName: "Sherpa Paraformer (中文)",
          type: "asr",
          size: "約 220MB",
          description: "Sherpa-ONNX 中文語音識別模型"
        }
      ]
    };
  });

  ipcMain.handle("get-current-model", async () => {
    const status = await ctx.sherpaManager.checkModelFiles();
    const activeType = ctx.databaseManager ? ctx.databaseManager.getSetting("asr_model_type", "paraformer") : "paraformer";
    return {
      model: activeType,
      status: status.models_downloaded ? "ready" : "not_downloaded",
      details: status
    };
  });

  ipcMain.handle("switch-model", async (event, modelName) => {
    try {
      if (ctx.databaseManager) {
        await ctx.databaseManager.setSetting('asr_model_type', modelName);
      }
      if (modelName === "qwen3_asr_gguf") {
        if (ctx.sherpaManager && typeof ctx.sherpaManager._stopSherpaServer === "function") {
          await ctx.sherpaManager._stopSherpaServer();
        }
      } else if (ctx.llamaManager && typeof ctx.llamaManager.stopServer === "function") {
        await ctx.llamaManager.stopServer();
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("check-model-exists", async (event, modelType, customPath) => {
    if (modelType === "qwen3_asr_gguf") {
      return await ctx.llamaManager.checkModelFiles();
    }
    return await ctx.sherpaManager.checkModelFiles(modelType, customPath);
  });

  ipcMain.handle("copy-model-to-custom", async (event, modelType, customPath) => {
    const defaultPath = ctx.sherpaManager.getModelCachePath(modelType, "");
    const destPath = path.join(customPath, ctx.sherpaManager.getModelConfig(modelType).name);
    return await ctx.sherpaManager.copyModelFiles(modelType, defaultPath, destPath);
  });

  ipcMain.handle("delete-model-files", async (event, modelType, customPath) => {
    if (modelType === "qwen3_asr_gguf") {
      return await ctx.llamaManager.deleteModelFiles();
    }
    return await ctx.sherpaManager.deleteModelFiles(modelType, customPath);
  });

  ipcMain.handle("get-model-path", (event, modelType, customPath) => {
    return ctx.sherpaManager.getModelCachePath(modelType, customPath);
  });

  ipcMain.handle("open-directory-dialog", async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    return result;
  });

  ipcMain.handle("test-sherpa-environment", async () => {
    try {
      ctx.logger && ctx.logger.info && ctx.logger.info('开始测试Sherpa环境');

      const sherpaStatus = await ctx.sherpaManager.checkStatus();

      const testResult = {
        success: true,
        sherpaStatus,
        timestamp: new Date().toISOString()
      };

      ctx.logger && ctx.logger.info && ctx.logger.info('Sherpa环境测试完成', testResult);

      return testResult;
    } catch (error) {
      const errorResult = {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };

      ctx.logger && ctx.logger.error && ctx.logger.error('Sherpa环境测试失败', errorResult);

      return errorResult;
    }
  });

  ipcMain.handle("restart-sherpa-server", async () => {
    if (isGgufModel(ctx)) {
      return await ctx.llamaManager.restartServer();
    }
    return await ctx.sherpaManager.restartServer();
  });

  // ===== Gemini Live Transcribe 串流 =====
  ipcMain.handle("cloud-live-start", async () => {
    try {
      const settings = getCloudAsrSettings(ctx);
      if (!isGeminiLiveSettings(settings)) {
        return { success: false, error: "Gemini Live is not configured" };
      }
      // 清理舊連線
      if (ctx.geminiLiveClient) {
        ctx.geminiLiveClient.disconnect();
      }
      ctx.geminiLiveClient = createGeminiLiveClient(ctx, settings);

      // 設定回呼 — 把 interim/final 文字送到 renderer
      ctx.geminiLiveClient.onInterimText = (text) => {
        sendCloudLiveText(ctx, "cloud-live-interim", text);
      };
      ctx.geminiLiveClient.onFinalText = (text) => {
        sendCloudLiveText(ctx, "cloud-live-final", text);
      };
      ctx.geminiLiveClient.onError = (err) => {
        const message = safeErrorMessage(err);
        ctx.logger?.error?.("[CloudLive] Error:", message);
        sendCloudLiveText(ctx, "cloud-live-error", message);
      };

      await ctx.geminiLiveClient.connect();
      return { success: true };
    } catch (error) {
      const message = safeErrorMessage(error);
      ctx.logger?.error?.("[CloudLive] Start failed:", message);
      return { success: false, error: message };
    }
  });

  ipcMain.handle("cloud-live-feed", async (_event, audioBase64) => {
    try {
      if (!ctx.geminiLiveClient || !ctx.geminiLiveClient.isConnected()) {
        return { success: false, error: "GeminiLive not connected" };
      }
      ctx.geminiLiveClient.sendAudioChunk(audioBase64);
      return { success: true };
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) };
    }
  });

  ipcMain.handle("cloud-live-end", async () => {
    try {
      if (!ctx.geminiLiveClient) {
        return { success: true, text: "" };
      }
      const finalText = await ctx.geminiLiveClient.endStream();
      ctx.geminiLiveClient.disconnect();
      ctx.geminiLiveClient = null;
      return { success: true, text: finalText };
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) };
    }
  });

  ipcMain.handle("cloud-live-abort", async () => {
    try {
      if (ctx.geminiLiveClient) {
        ctx.geminiLiveClient.disconnect();
        ctx.geminiLiveClient = null;
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) };
    }
  });
};

module.exports.isGeminiLiveSettings = isGeminiLiveSettings;
module.exports.createGeminiLiveClient = createGeminiLiveClient;
module.exports.sendCloudLiveText = sendCloudLiveText;
