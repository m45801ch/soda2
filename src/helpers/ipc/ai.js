const { ipcMain } = require("electron");
const { BUILTIN_STYLE_PACK } = require("../aiPrompts");

module.exports = function register(ctx) {
  // 取得 AI 優化當日成功次數（按廠商）
  ipcMain.handle("ai-get-usage", async () => {
    try {
      return ctx.databaseManager.getAiUsage();
    } catch (e) {
      return { today: new Date().toISOString().slice(0, 10), usage: {} };
    }
  });

  // AI文本处理（實作在 aiTextProcessor.js）
  ipcMain.handle("process-text", async (event, text, mode = 'optimize') => {
    try {
      // 1. 優先偵測與套用全新的 AI風格包 體系
      const styleSettings = ctx.databaseManager.getSetting('ai_style_settings', null);
      if (styleSettings) {
        const { buildPrompt } = require("../promptBuilder");
        const customWords = ctx.databaseManager.getSetting('custom_words', []);
        const compiledPrompt = buildPrompt(styleSettings, customWords);
        const customPrompt = compiledPrompt.replace(/\$\{output\}/g, text);
        return await ctx.aiProcessor.processTextWithAI(text, mode, customPrompt);
      }

      // 2. 舊版風格包相容模式
      const activePackId = ctx.databaseManager.getSetting('ai_style_pack_active', 'builtin-default');
      if (activePackId !== 'builtin-default') {
        const packs = ctx.databaseManager.getSetting('ai_style_packs', []);
        const pack = packs.find(p => p.id === activePackId);
        if (pack && pack.prompts && pack.prompts[mode]) {
          const customPrompt = pack.prompts[mode].replace(/\$\{text\}/g, text);
          return await ctx.aiProcessor.processTextWithAI(text, mode, customPrompt);
        }
      }
      return await ctx.aiProcessor.processTextWithAI(text, mode);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("check-ai-status", async (event, testConfig = null) => {
    return await ctx.aiProcessor.checkAIStatus(testConfig);
  });

  ipcMain.handle("fetch-provider-models", async (event, providerSettings) => {
    try {
      const { provider_id, base_url, api_key } = providerSettings;
      let endpoint = base_url.trim().replace(/\/$/, "");
      
      const url = `${endpoint}/models`;
      const headers = {
        "Content-Type": "application/json"
      };
      if (api_key) {
        if (provider_id === 'anthropic') {
          headers["x-api-key"] = api_key;
          headers["anthropic-version"] = "2023-06-01";
        } else {
          headers["Authorization"] = `Bearer ${api_key}`;
        }
      }
      
      const response = await fetch(url, {
        method: "GET",
        headers: headers,
        signal: AbortSignal.timeout(10000)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error (${response.status}): ${errorText || response.statusText}`);
      }
      
      const parsed = await response.json();
      let models = [];
      if (parsed.data && Array.isArray(parsed.data)) {
        for (const entry of parsed.data) {
          if (entry.id) models.push(entry.id);
          else if (entry.name) models.push(entry.name);
        }
      } else if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === 'string') models.push(entry);
          else if (entry && typeof entry === 'object' && entry.id) models.push(entry.id);
        }
      }
      // Sort models alphabetically
      models.sort();
      return { success: true, models };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 風格包管理
  ipcMain.handle("get-style-packs", async () => {
    try {
      const packs = ctx.databaseManager.getSetting('ai_style_packs', []);
      const activeId = ctx.databaseManager.getSetting('ai_style_pack_active', 'builtin-default');
      return { success: true, packs: [BUILTIN_STYLE_PACK, ...packs], activeId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("save-style-pack", async (event, pack) => {
    try {
      const packs = ctx.databaseManager.getSetting('ai_style_packs', []);
      const idx = packs.findIndex(p => p.id === pack.id);
      if (idx >= 0) {
        packs[idx] = pack;
      } else {
        packs.push(pack);
      }
      ctx.databaseManager.setSetting('ai_style_packs', packs);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("delete-style-pack", async (event, packId) => {
    try {
      const packs = ctx.databaseManager.getSetting('ai_style_packs', []);
      const filtered = packs.filter(p => p.id !== packId);
      ctx.databaseManager.setSetting('ai_style_packs', filtered);
      const activeId = ctx.databaseManager.getSetting('ai_style_pack_active', 'builtin-default');
      if (activeId === packId) {
        ctx.databaseManager.setSetting('ai_style_pack_active', 'builtin-default');
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("set-active-style-pack", async (event, packId) => {
    try {
      ctx.databaseManager.setSetting('ai_style_pack_active', packId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
};
