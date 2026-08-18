import React, { useState, useEffect } from "react";
import { Plus, Edit2, Trash2, RotateCcw, Check, CheckCircle, Save, Sparkles, BookText, Tag, Shield, Info, HelpCircle, FileText } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_MAIN_PROMPT,
  DEFAULT_MODES,
  DEFAULT_DICTIONARIES,
  getDefaultStyleSettings,
  extractStyleMetadata,
  extractDictMetadata
} from "./stylePackDefaults";

const AIStylePackManager = ({ t }) => {
  const [activeTab, setActiveTab] = useState(0);
  const [settings, setSettings] = useState(getDefaultStyleSettings());
  const [customWords, setCustomWords] = useState([]);
  const [loading, setLoading] = useState(true);

  // 用於新增/編輯模式或詞庫的對話方塊狀態
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingType, setEditingType] = useState(null); // 'main' | 'mode' | 'dict'
  const [editingKey, setEditingKey] = useState(null);
  const [editorName, setEditorName] = useState("");
  const [editorDescription, setEditorDescription] = useState("");
  const [editorContent, setEditorContent] = useState("");

  // 熱詞管理相關狀態
  const [newWord, setNewWord] = useState("");
  // 內建詞庫的自訂補充內容
  const [editorExtraContent, setEditorExtraContent] = useState("");

  const tabs = [
    { name: t?.("settings.style.tabs.mainPrompt") || "主 Prompt", index: 0 },
    { name: t?.("settings.style.tabs.modes") || "修飾模式", index: 1 },
    { name: t?.("settings.style.tabs.hotwords") || "熱詞", index: 2 },
    { name: t?.("settings.style.tabs.dicts") || "專業詞庫", index: 3 },
    { name: t?.("settings.style.tabs.customRules") || "自訂規則", index: 4 },
  ];

  // 載入設定
  useEffect(() => {
    const loadAll = async () => {
      try {
        setLoading(true);
        if (window.electronAPI) {
          const savedSettings = await window.electronAPI.getSetting("ai_style_settings", null);
          if (savedSettings) {
            setSettings({ ...getDefaultStyleSettings(), ...savedSettings });
          }
          const savedWords = await window.electronAPI.getSetting("custom_words", []);
          setCustomWords(savedWords || []);
        }
      } catch (e) {
        console.error("載入風格包設定失敗:", e);
      } finally {
        setLoading(false);
      }
    };
    loadAll();
  }, []);

  // 儲存設定並套用
  const applySettings = async (newSettings, updatedWords = customWords) => {
    setSettings(newSettings);
    if (window.electronAPI) {
      await window.electronAPI.setSetting("ai_style_settings", newSettings);
      await window.electronAPI.setSetting("custom_words", updatedWords);
      // 雙向同步：風格包熱詞變更 → 同步到設定-熱詞（hotwords.txt，影響 ASR/GGUF 辨識）
      try {
        const res = await window.electronAPI.getHotwords();
        const current = (res && res.words) || [];
        const updated = Array.isArray(updatedWords) ? updatedWords.map(w => String(w).trim()).filter(Boolean) : [];
        if (JSON.stringify(current) !== JSON.stringify(updated)) {
          await window.electronAPI.setHotwords({
            enabled: true,
            score: (res && res.score) || 1.5,
            words: updated,
          });
        }
      } catch (e) { /* 同步失敗不影響設定 */ }
    }
  };

  const openEditor = (type, key = null) => {
    setEditingType(type);
    setEditingKey(key);

    if (key) {
      if (type === "main") {
        const mains = getAvailableMainPrompts();
        setEditorName(mains[key]?.name || "");
        setEditorDescription(mains[key]?.description || "");
        setEditorContent(mains[key]?.content || "");
        setEditorExtraContent("");
      } else if (type === "mode") {
        const modes = getAvailableModes();
        setEditorName(modes[key]?.name || "");
        setEditorDescription(modes[key]?.description || "");
        setEditorContent(modes[key]?.content || "");
        setEditorExtraContent("");
      } else {
        const dicts = getAvailableDictionaries();
        setEditorName(dicts[key]?.name || "");
        setEditorDescription(dicts[key]?.description || "");
        setEditorContent(dicts[key]?.content || "");
        setEditorExtraContent(settings.customDictionaries?.[key]?.extraContent || "");
      }
    } else {
      setEditorName("");
      setEditorDescription("");
      setEditorContent("");
      setEditorExtraContent("");
    }

    setEditorOpen(true);
  };

  const saveEditor = async () => {
    if (!editorName.trim() || !editorContent.trim()) return;

    const key = editingKey || `custom_${Date.now()}`;
    const newSettings = { ...settings };

    const itemData = {
      name: editorName.trim(),
      description: editorDescription.trim() || `${editorName.trim()} 的自訂描述`,
      content: editorContent.trim(),
    };

    if (editingType === "main") {
      newSettings.customMainPrompts = {
        ...newSettings.customMainPrompts,
        [key]: itemData,
      };
    } else if (editingType === "mode") {
      newSettings.customModes = {
        ...newSettings.customModes,
        [key]: itemData,
      };
    } else if (editingType === "dict") {
      // 內建詞庫：保留原內容，只存 extraContent
      if (isDefaultItem(editingKey) && editorExtraContent.trim()) {
        const existing = settings.customDictionaries?.[editingKey] || {};
        newSettings.customDictionaries = {
          ...newSettings.customDictionaries,
          [editingKey]: {
            ...existing,
            name: editorName.trim(),
            description: editorDescription.trim(),
            content: editorContent.trim(),
            extraContent: editorExtraContent.trim(),
          },
        };
      } else if (isDefaultItem(editingKey)) {
        // 內建詞庫無補充內容時，清除 customDictionaries 中的該 key
        const { [editingKey]: _, ...rest } = settings.customDictionaries || {};
        newSettings.customDictionaries = rest;
      } else {
        newSettings.customDictionaries = {
          ...newSettings.customDictionaries,
          [key]: itemData,
        };
      }
    }

    setEditorOpen(false);
    await applySettings(newSettings);
    toast.success(t?.("settings.style.toast.changesApplied") || "設定已套用");
  };

  const deleteCustomItem = async (type, key) => {
    if (!confirm(t?.("settings.style.toast.confirmDelete") || "您確定要刪除此自訂項目嗎？")) return;

    const newSettings = { ...settings };
    if (type === "main") {
      const { [key]: _, ...rest } = newSettings.customMainPrompts || {};
      newSettings.customMainPrompts = rest;
      if (newSettings.activeMainPrompt === key) {
        newSettings.activeMainPrompt = "default";
      }
    } else if (type === "mode") {
      const { [key]: _, ...rest } = newSettings.customModes || {};
      newSettings.customModes = rest;
      if (newSettings.activeMode === key) {
        newSettings.activeMode = "general";
      }
    } else {
      const { [key]: _, ...rest } = newSettings.customDictionaries || {};
      newSettings.customDictionaries = rest;
      newSettings.activeDictionaries = (newSettings.activeDictionaries || []).filter(
        (k) => k !== key
      );
    }
    await applySettings(newSettings);
    toast.success(t?.("settings.style.toast.itemDeleted") || "項目已刪除");
  };

  const resetDefaultItem = async (type, key) => {
    if (!confirm(t?.("settings.style.toast.confirmReset") || "您確定要還原此預設項目的內容嗎？")) return;

    const newSettings = { ...settings };
    if (type === "main") {
      return;
    } else if (type === "mode") {
      const { [key]: _, ...rest } = newSettings.customModes || {};
      newSettings.customModes = rest;
    } else {
      const { [key]: _, ...rest } = newSettings.customDictionaries || {};
      newSettings.customDictionaries = rest;
    }
    await applySettings(newSettings);
    toast.success(t?.("settings.style.toast.resetDone") || "已重設為預設值");
  };

  const handleAddWord = async () => {
    const trimmedWord = newWord.trim();
    if (trimmedWord) {
      if (customWords.includes(trimmedWord)) {
        toast.error("此熱詞已存在");
        return;
      }
      const updated = [...customWords, trimmedWord];
      setCustomWords(updated);
      setNewWord("");
      await applySettings(settings, updated);
      toast.success("熱詞已新增");
    }
  };

  const handleRemoveWord = async (wordToRemove) => {
    const updated = customWords.filter((word) => word !== wordToRemove);
    setCustomWords(updated);
    await applySettings(settings, updated);
    toast.success("熱詞已移除");
  };

  const getAvailableMainPrompts = () => {
    return {
      default: {
        name: "預設核心提示詞",
        description: "系統預設的核心身份定義與規則，確保語音修飾的極致準確性與原意保留。",
        content: DEFAULT_MAIN_PROMPT,
      },
      ...(settings.customMainPrompts || {}),
    };
  };

  const getAvailableModes = () => {
    return { ...DEFAULT_MODES, ...(settings.customModes || {}) };
  };

  const getAvailableDictionaries = () => {
    return { ...DEFAULT_DICTIONARIES, ...(settings.customDictionaries || {}) };
  };

  const isDefaultItem = (key) => {
    if (!key) return false;
    return (
      key === "default" ||
      key === "general" ||
      key === "business" ||
      key === "meeting" ||
      key === "verbatim" ||
      key === "chat" ||
      key === "email" ||
      key === "line" ||
      key === "social" ||
      key === "teaching" ||
      key === "notes" ||
      key === "official" ||
      key === "ai" ||
      key === "coding" ||
      key === "medical" ||
      key === "legal" ||
      key === "engineering" ||
      key === "education"
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <RotateCcw className="w-8 h-8 animate-spin text-blue-500" />
        <span className="mt-2 text-sm text-gray-500 dark:text-gray-400">載入風格包設定中...</span>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 pb-8 select-none text-gray-800 dark:text-gray-200">
      <div className="text-start">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 chinese-title flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-blue-500" />
          {t?.("settings.style.title") || "AI 風格包調色盤"}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {t?.("settings.style.description") || "藉由組合核心主提示詞、不同情境的修飾模式、領域專有名詞卡與自訂規則，動態編譯出最完美的 AI 潤飾效果。"}
        </p>
      </div>

      {/* Tabs 導航 */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto whitespace-nowrap">
        {tabs.map((tab) => (
          <button
            key={tab.index}
            onClick={() => setActiveTab(tab.index)}
            className={`px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none ${
              activeTab === tab.index
                ? "text-blue-500 border-b-2 border-blue-500"
                : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            }`}
          >
            {tab.name}
          </button>
        ))}
      </div>

      {/* 內容區塊 */}
      <div className="pt-2 text-start">
        {/* Tab 1: 主 Prompt */}
        {activeTab === 0 && (
          <div className="space-y-4 rounded-xl p-4 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">設定核心主 Prompt</h3>
                <p className="text-xs text-gray-500 mt-1">
                  定義 AI 扮演的角色身份，確保事實不被捏造與不回覆原文指令等底線。
                </p>
              </div>
              <button
                onClick={() => openEditor("main")}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> 新增主 Prompt
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              {Object.entries(getAvailableMainPrompts()).map(([key, main]) => {
                const isActive = settings.activeMainPrompt === key;
                const isDefault = key === "default";
                return (
                  <div
                    key={key}
                    onClick={() => applySettings({ ...settings, activeMainPrompt: key })}
                    onDoubleClick={() => openEditor("main", key)}
                    className={`p-4 rounded-xl border cursor-pointer flex flex-col justify-between transition-all relative group min-h-[120px] ${
                      isActive
                        ? "border-blue-500 bg-blue-50/40 dark:bg-blue-950/20 border-2"
                        : "border-gray-200 dark:border-gray-700 hover:border-blue-400"
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-sm text-gray-900 dark:text-gray-100">
                            {main.name}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-gray-200/60 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded">
                            {isDefault ? "內建" : "自訂"}
                          </span>
                        </div>
                        {isActive && (
                          <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-950/50 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Check className="w-3 h-3" /> 使用中
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-3 leading-relaxed">
                        {main.description}
                      </p>
                    </div>

                    <div className="flex gap-2 mt-3 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditor("main", key); }}
                        className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-950 text-gray-400 hover:text-blue-500"
                        title={isDefault ? "檢視" : "編輯"}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {!isDefault && (
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteCustomItem("main", key); }}
                          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-950/50 text-gray-400 hover:text-red-500"
                          title="刪除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 2: 修飾模式 */}
        {activeTab === 1 && (
          <div className="space-y-4 rounded-xl p-4 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">選擇修飾模式 (Style)</h3>
                <p className="text-xs text-gray-500 mt-1">
                  改變輸出的格式、語氣與編排風格（例如商務書信、LINE 簡短語氣或逐字稿）。
                </p>
              </div>
              <button
                onClick={() => openEditor("mode")}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> 新增模式
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              {Object.entries(getAvailableModes()).map(([key, mode]) => {
                const isActive = settings.activeMode === key;
                const isCustom = key.startsWith("custom_");
                const isModifiedDefault = !isCustom && !!settings.customModes?.[key];
                return (
                  <div
                    key={key}
                    onClick={() => applySettings({ ...settings, activeMode: key })}
                    onDoubleClick={() => openEditor("mode", key)}
                    className={`p-4 rounded-xl border cursor-pointer flex flex-col justify-between transition-all relative group min-h-[120px] ${
                      isActive
                        ? "border-blue-500 bg-blue-50/40 dark:bg-blue-950/20 border-2"
                        : "border-gray-200 dark:border-gray-700 hover:border-blue-400"
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-sm text-gray-900 dark:text-gray-100">
                            {mode.name}
                          </span>
                          {!isCustom && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-gray-200/60 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded">
                              {isModifiedDefault ? "已修改" : "內建"}
                            </span>
                          )}
                          {isCustom && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400 rounded">
                              自訂
                            </span>
                          )}
                        </div>
                        {isActive && (
                          <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-950/50 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Check className="w-3 h-3" /> 使用中
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-3 leading-relaxed">
                        {mode.description}
                      </p>
                    </div>

                    <div className="flex gap-2 mt-3 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditor("mode", key); }}
                        className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-950 text-gray-400 hover:text-blue-500"
                        title="編輯"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {isCustom ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteCustomItem("mode", key); }}
                          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-950/50 text-gray-400 hover:text-red-500"
                          title="刪除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        isModifiedDefault && (
                          <button
                            onClick={(e) => { e.stopPropagation(); resetDefaultItem("mode", key); }}
                            className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-950 text-gray-400 hover:text-blue-500"
                            title="還原為預設範本"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 3: Hotwords */}
        {activeTab === 2 && (
          <div className="space-y-4 rounded-xl p-5 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">
                本地熱詞 (Hotwords)
              </h3>
              <p className="text-xs text-gray-500">
                如果語音中有發音類似的內容，引導 AI 優先將其替換為這些正確的專有名詞與拼寫。
              </p>

              <div className="flex gap-2 max-w-lg pt-3">
                <input
                  type="text"
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  value={newWord}
                  onChange={(e) => setNewWord(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddWord()}
                  placeholder="例如: soda2, DeepSeek, Cursor"
                />
                <button
                  onClick={handleAddWord}
                  disabled={!newWord.trim()}
                  className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  新增
                </button>
              </div>
            </div>

            <div className="min-h-[144px] max-h-60 overflow-y-auto p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-wrap gap-2 items-start content-start">
              {customWords.length === 0 ? (
                <span className="text-xs text-gray-400 py-8 w-full text-center">
                  目前尚未加入任何熱詞。您也可以在「熱詞管理」分頁管理此清單。
                </span>
              ) : (
                customWords.map((word) => (
                  <button
                    key={word}
                    onClick={() => handleRemoveWord(word)}
                    className="px-2.5 py-1 rounded-lg text-xs bg-gray-100 dark:bg-gray-700 hover:bg-red-50 dark:hover:bg-red-950/30 border border-gray-200 dark:border-gray-600 hover:border-red-300 text-gray-800 dark:text-gray-200 flex items-center gap-1.5 transition-colors"
                  >
                    <span>{word}</span>
                    <span className="text-[10px] text-gray-400 group-hover:text-red-500 font-bold">
                      &times;
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab 4: 專業詞庫 */}
        {activeTab === 3 && (
          <div className="space-y-4 rounded-xl p-4 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">領域專業詞庫 (Dictionaries)</h3>
                <p className="text-xs text-gray-500 mt-1">
                  勾選要啟用的專業名詞庫，提供特定領域（如程式開發、醫學、法律）的英文縮寫與專有名詞對照表。
                </p>
              </div>
              <button
                onClick={() => openEditor("dict")}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> 新增詞庫
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              {Object.entries(getAvailableDictionaries()).map(([key, dict]) => {
                const isActive = (settings.activeDictionaries || []).includes(key);
                const isCustom = key.startsWith("custom_");
                const isModifiedDefault = !isCustom && !!settings.customDictionaries?.[key];
                return (
                  <div
                    key={key}
                    onClick={() => {
                      const activeDicts = settings.activeDictionaries || [];
                      const newDicts = isActive
                        ? activeDicts.filter((k) => k !== key)
                        : [...activeDicts, key];
                      applySettings({
                        ...settings,
                        activeDictionaries: newDicts,
                      });
                    }}
                    onDoubleClick={() => openEditor("dict", key)}
                    className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between group min-h-[120px] ${
                      isActive
                        ? "border-blue-500 bg-blue-50/40 dark:bg-blue-950/20 border-2"
                        : "border-gray-200 dark:border-gray-700 hover:border-blue-400"
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${
                              isActive
                                ? "bg-blue-600 border-blue-600 text-white"
                                : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                            }`}
                          >
                            {isActive && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                          <span className="font-bold text-sm text-gray-900 dark:text-gray-100">
                            {dict.name}
                          </span>
                          {!isCustom && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-gray-200/60 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded">
                              {isModifiedDefault ? "已修改" : "內建"}
                            </span>
                          )}
                          {isCustom && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400 rounded">
                              自訂
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed pl-6 line-clamp-3">
                        {dict.description}
                      </p>
                    </div>

                    <div
                      className="flex gap-2 mt-3 justify-end opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => openEditor("dict", key)}
                        className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-950 text-gray-400 hover:text-blue-500"
                        title="編輯"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {isCustom ? (
                        <button
                          onClick={() => deleteCustomItem("dict", key)}
                          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-950/50 text-gray-400 hover:text-red-500"
                          title="刪除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        isModifiedDefault && (
                          <button
                            onClick={() => resetDefaultItem("dict", key)}
                            className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-950 text-gray-400 hover:text-blue-500"
                            title="還原為預設詞庫"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 5: 自訂規則 */}
        {activeTab === 4 && (
          <div className="space-y-4 rounded-xl p-4 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">使用者自訂規則</h3>
            <p className="text-xs text-gray-500">
              撰寫您自己專屬的 Prompt 指令規則，例如：「一律將英文名詞首字母大寫」或「結尾自動加上你的名字」。這段文字會自動被追加至最終編譯的 Prompt 末端。
            </p>
            <textarea
              value={settings.customRules || ""}
              onChange={(e) => {
                applySettings({ ...settings, customRules: e.target.value });
              }}
              placeholder="請在此輸入您的自訂修飾規則，例如：
- 請將語句中的「回報」一律替換為「報告」。
- 對於技術縮寫，請保持全大寫格式。"
              className="w-full h-48 p-3 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none leading-relaxed"
            />
          </div>
        )}

      </div>

      {/* Editor Modal */}
      {editorOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 space-y-4 shadow-2xl text-start">
            <h3 className="text-md font-bold text-blue-600 dark:text-blue-400 border-b border-gray-200 dark:border-gray-700 pb-2 flex items-center gap-2">
              <FileText className="w-5 h-5" />
              {editingKey === "default"
                ? "檢視預設內容"
                : editingKey
                ? "編輯自訂內容"
                : "新增自訂內容"}
            </h3>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                名稱
              </label>
              <input
                value={editorName}
                onChange={(e) => setEditorName(e.target.value)}
                placeholder="例如: 科技會議, 極簡模式..."
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                disabled={isDefaultItem(editingKey)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                簡介描述
              </label>
              <input
                value={editorDescription}
                onChange={(e) => setEditorDescription(e.target.value)}
                placeholder="簡短介紹這個卡片的作用..."
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                disabled={isDefaultItem(editingKey)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                Prompt / 內容
              </label>
              <textarea
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                className="w-full h-48 p-3 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none leading-relaxed font-mono"
                placeholder="請輸入 Prompt 提示詞..."
                disabled={isDefaultItem(editingKey)}
              />
            </div>

            {/* 內建詞庫：自訂補充內容 */}
            {isDefaultItem(editingKey) && editingType === "dict" && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                  <Plus className="w-3 h-3" />
                  自訂補充詞彙
                  <span className="font-normal text-gray-400 dark:text-gray-500">（追加到內建內容後面）</span>
                </label>
                <textarea
                  value={editorExtraContent}
                  onChange={(e) => setEditorExtraContent(e.target.value)}
                  className="w-full h-32 p-3 text-sm border border-amber-300 dark:border-amber-600 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none leading-relaxed font-mono"
                  placeholder={`例如：\n- **MLOps**: 機器學習運維\n- **Transformer**: 轉換器架構`}
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              {isDefaultItem(editingKey) ? (
                <button
                  onClick={() => setEditorOpen(false)}
                  className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  關閉
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setEditorOpen(false)}
                    className="px-4 py-2 text-sm font-semibold border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={saveEditor}
                    disabled={!editorName.trim() || !editorContent.trim()}
                    className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    儲存
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AIStylePackManager;
