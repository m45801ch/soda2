import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { toast, Toaster } from "sonner";
import { Settings, Eye, EyeOff, X, Loader2, TestTube, CheckCircle, XCircle, Mic, Shield, Globe, Keyboard, Sparkles, BookText, Tag, History, Info, Heart, Smile, Cpu, Download, Trash2, Play, WifiOff, Wifi, Radio, Palette, FolderOpen, Database, UploadCloud, RefreshCw, HardDriveDownload } from "lucide-react";
import { usePermissions } from "./hooks/usePermissions";
import PermissionCard from "./components/ui/permission-card";
import HotkeySettings from "./components/HotkeySettings";
import HotwordsManager from "./components/HotwordsManager";
import DictionaryManager from "./components/DictionaryManager";
import EmojiManager from "./components/EmojiManager";
import HistoryView from "./components/HistoryView";
import BackupPanel from "./components/BackupPanel";
import { useTranslation, LanguageProvider } from "./i18n";
import AIStylePackManager from "./components/AIStylePackManager";
import { playBase64Sound, tryUnlock } from "./utils/audioPlayer";

// 設定面板左側分頁（依重要性排序）
const SETTINGS_TABS = [
  { id: 'general', labelKey: 'settings.tabs.general', icon: Settings },
  { id: 'models', labelKey: 'settings.tabs.models', icon: Cpu },
  { id: 'history', labelKey: 'settings.tabs.history', icon: History },
  { id: 'ai', labelKey: 'settings.tabs.ai', icon: Sparkles },
  { id: 'ai-style', labelKey: 'settings.tabs.aiStylePack', icon: Palette },
  { id: 'hotkeys', labelKey: 'settings.tabs.hotkeys', icon: Keyboard },
  { id: 'hotwords', labelKey: 'settings.tabs.hotwords', icon: Tag },
  { id: 'dictionary', labelKey: 'settings.tabs.dictionary', icon: BookText },
  { id: 'emoji', labelKey: 'settings.tabs.emoji', icon: Smile },
  { id: 'permissions', labelKey: 'settings.tabs.permissions', icon: Shield },
  { id: 'backup', labelKey: 'settings.tabs.backup', icon: Database },
  { id: 'about', labelKey: 'settings.tabs.about', icon: Info },
];

// 本地 ASR 模型清單
const LOCAL_ASR_MODELS = [
  {
    id: 'paraformer',
    name: 'Paraformer 中文',
    description: '專注中文的高精度離線語音辨識，輕量（約 80MB）、CPU 友善，是預設推薦的本地模型。',
    size: '~80 MB',
  },
  {
    id: 'sense_voice',
    name: 'SenseVoice 多語言',
    description: '支援中、英、日、韓、粵語，準確度高（約 330MB），適合多語境混合使用場景。',
    size: '~330 MB',
  },
  {
    id: 'whisper',
    name: 'Whisper Small',
    description: 'OpenAI Whisper 的輕量版，繁體中文能力強，語音識別效果穩定（約 200MB）。',
    size: '~200 MB',
  },
  {
    id: 'qwen3_asr',
    name: 'Qwen3-ASR (0.6B)',
    description: '阿里巴巴 Qwen3 語音辨識模型，支援多語言，大模型準確度（約 982MB），需要較大記憶體。',
    size: '~982 MB',
  },
  {
    id: 'breeze_asr_25',
    name: 'Breeze-ASR-25（聯發科）',
    description: '聯發科技研發，針對繁體中文及中英混用最佳化，大模型精度（約 1.8GB），適合有足夠 RAM 的設備。',
    size: '~1.8 GB',
  },
  {
    id: 'qwen3_asr_gguf',
    name: 'Qwen3-ASR 1.7B (GGUF)',
    description: '阿里巴巴 Qwen3 大模型語音辨識（1.7B），llama.cpp GGUF 格式，需下載 llama-server 引擎（約 1.5GB）。',
    size: '~1.5 GB',
  },
];

// AI 模型商供應商清單（對應 yukey 的 PostProcessProvider）
const AI_PROVIDERS = [
  { id: 'openai',     label: 'OpenAI',     base_url: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'google',     label: 'Google (Gemini)', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/app/apikey' },
  { id: 'anthropic',  label: 'Anthropic',  base_url: 'https://api.anthropic.com/v1', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openrouter', label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/settings/keys' },
  { id: 'groq',       label: 'Groq',       base_url: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys' },
  { id: 'cerebras',   label: 'Cerebras',   base_url: 'https://api.cerebras.ai/v1', keyUrl: 'https://cloud.cerebras.ai/' },
  { id: 'zai',        label: 'Z.AI',       base_url: 'https://api.z.ai/api/paas/v4', keyUrl: 'https://z.ai/manage-apikey/apikey-list' },
  { id: 'custom',     label: 'Custom',     base_url: 'http://localhost:11434/v1' },
];

export const DEFAULT_CLOUD_ASR_SETTINGS = {
  enabled: false,
  provider: 'openai',
  api_key: '',
  api_keys: {},
  base_url: '',
  model: '',
  gemini_mode: 'rest',
  transcription_mode: 'smart',
  language_code: '',
};

export const updateGeminiMode = (settings = {}, mode) => {
  const gemini_mode = mode === 'live' ? 'live' : 'rest';
  return {
    ...settings,
    gemini_mode,
    model: gemini_mode === 'live'
      ? 'gemini-3.5-transcribe-live'
      : 'gemini-3.5-transcribe',
  };
};

export const normalizeCloudAsrSettings = (settings = {}) => {
  const normalized = { ...DEFAULT_CLOUD_ASR_SETTINGS, ...settings };
  return normalized.provider === 'gemini_transcribe'
    ? updateGeminiMode(normalized, normalized.gemini_mode)
    : normalized;
};

export const cloudAsrTestError = () => '連線測試失敗，請檢查網路與 API 金鑰。';

const SettingsPage = () => {
  const { t, language, setLanguage, languages } = useTranslation();
  const [activeTab, setActiveTab] = useState('general');

  const [settings, setSettings] = useState({
    ai_api_key: "",
    ai_base_url: "https://api.openai.com/v1",
    ai_model: "gpt-4o-mini",
    enable_ai_optimization: false,
    enable_notifications: true,
    enable_streaming_mode: false,
    language: "zh-TW",
    convert_transcription: true,
    asr_profile: "standard",          // 效能模式：standard（最準）/ fast（弱 CPU）
    asr_acceleration: "auto",           // 加速模式：auto（自動）/ cpu / gpu
    mic_device_id: "",                // 指定麥克風（空=系統預設）
    mic_auto_gain: true,              // 自動增益（AGC）
    typeless_trigger: "default",      // 錄音觸發鍵（issue #12：可自訂避開衝突）
    auto_format_lists: false,         // 自動列點（第一二三→1.2.3），預設關
    convert_ordinal_numbers: true,       // 中文序數轉阿拉伯數字，預設開
    auto_line_break: false,           // 依停頓自動分行（issue #17），預設關
    save_audio: true,                 // 保存錄音檔（給重新辨識用），預設開
    audio_retention_days: 30,         // 錄音保留天數（0=永久）
    // 錄音完成後動作設定（自動貼上已固定開啟，僅保留「自動送出 Enter」）
    auto_enter_after_paste: false,    // 貼上後自動送出（完全信任模式）
    // 視窗控制設定
    window_always_on_top: true,       // 視窗置頂
    minimize_to_tray: true,           // 縮小到系統托盤
    close_to_tray: true,              // 關閉到系統托盤
    auto_start: false,                // 開機自啟動
    auto_start_minimized: true,       // 開機自啟動時縮到托盤
    recording_sound_enabled: true,    // 錄音音效回饋
    sound_feedback_volume: 0.8,       // 音效回饋音量
    sound_theme: 'coin01',            // 音效主題
    mute_while_recording: false,       // 錄音時靜音系統音訊
    app_theme: 'system'                // 應用主題
  });
  
  const [customModel, setCustomModel] = useState(false);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [streamingModelStatus, setStreamingModelStatus] = useState(null);
  const [streamingModelDownloading, setStreamingModelDownloading] = useState(false);
  const [streamingModelProgress, setStreamingModelProgress] = useState(0);
  const [streamingModelPhase, setStreamingModelPhase] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [aiSaveStatus, setAiSaveStatus] = useState(null); // null | 'saving' | 'saved'
  const [selectedProviderId, setSelectedProviderId] = useState('openai');
  const [aiProviderKeys, setAiProviderKeys] = useState({});      // { providerId: apiKey }
  const [aiProviderUrls, setAiProviderUrls] = useState({});      // { providerId: baseUrl }
  const [aiProviderModels, setAiProviderModels] = useState({});  // { providerId: model }
  const [aiModelsList, setAiModelsList] = useState([]);          // 目前 provider 的模型清單
  const [fetchingModels, setFetchingModels] = useState(false);
  const [micDevices, setMicDevices] = useState([]); // 可選的麥克風清單
  const [runtimeInfo, setRuntimeInfo] = useState(null);
  const [appVersion, setAppVersion] = useState(''); // 真實版本號（issue #15：別再寫死 v1.0.1）
  const [aiUsage, setAiUsage] = useState(null); // 當日 AI 優化成功次數 { today, usage: {provider: count} }
  const [micMonitorLevel, setMicMonitorLevel] = useState(0);
  const [micMonitorError, setMicMonitorError] = useState("");
  const [micMonitorActive, setMicMonitorActive] = useState(false);
  const micMonitorRef = useRef({ raf: 0, context: null, stream: null });

  // ===== 模型選擇分頁狀態 =====
  const [modelSubTab, setModelSubTab] = useState('local'); // 'local' | 'cloud'
  const [selectedModelType, setSelectedModelType] = useState('paraformer'); // 目前啟用的本地模型
  const [modelStatuses, setModelStatuses] = useState({}); // { [modelId]: true/false } 是否已下載
  const [modelDirsExist, setModelDirsExist] = useState({}); // { [modelId]: true/false } 目錄是否存在
  const [modelBundled, setModelBundled] = useState({}); // { [modelId]: true/false } 是否為安裝包內建（不可刪除）
  const [modelDir, setModelDir] = useState({ currentDir: '', isCustom: false, defaultDir: '' });
  const [modelDownloading, setModelDownloading] = useState(null); // 正在下載的 modelId
  const [modelDownloadProgress, setModelDownloadProgress] = useState(0);
  const [modelDeleting, setModelDeleting] = useState(null); // 正在刪除的 modelId
  const [cloudAsrSettings, setCloudAsrSettings] = useState(DEFAULT_CLOUD_ASR_SETTINGS);
  const [cloudAsrTesting, setCloudAsrTesting] = useState(false);
  const [cloudAsrTestResult, setCloudAsrTestResult] = useState(null);

  // 权限管理
  const showAlert = (alert) => {
    toast(alert.title, {
      description: alert.description,
      duration: 4000,
    });
  };

  const {
    micPermissionGranted,
    accessibilityPermissionGranted,
    requestMicPermission,
    testAccessibilityPermission,
  } = usePermissions(showAlert);

  // 加载设置
  useEffect(() => {
    loadSettings();
    // 取真實版本號顯示在「關於」（issue #15）
    window.electronAPI?.getAppVersion?.().then((v) => { if (v) setAppVersion(v); }).catch(() => {});

    // 監聽設定變化，與主視窗同步
    if (window.electronAPI?.onSettingChanged) {
      const unsubscribe = window.electronAPI.onSettingChanged((data) => {
        if (data.key === 'enable_ai_optimization') {
          setSettings(prev => ({ ...prev, enable_ai_optimization: data.value === true }));
        }
      });
      return () => { if (unsubscribe) unsubscribe(); };
    }
  }, []);

  useEffect(() => {
    try {
      const info = window.electronAPI?.getRuntimeInfo?.();
      if (info) setRuntimeInfo(info);
    } catch (e) {
      setRuntimeInfo(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadStreamingModelStatus = async () => {
      try {
        if (!window.electronAPI?.checkStreamingModelFiles) return;
        const status = await window.electronAPI.checkStreamingModelFiles();
        if (!cancelled) setStreamingModelStatus(status);
      } catch (e) {
        if (!cancelled) setStreamingModelStatus(null);
      }
    };
    loadStreamingModelStatus();
    const cleanup = window.electronAPI?.onStreamingModelDownloadProgress?.((progress) => {
      if (progress?.stage) {
        setStreamingModelPhase(progress.stage);
      }
      if (progress?.progress != null) {
        setStreamingModelProgress(progress.progress);
      }
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  // 載入模型目錄路徑
  useEffect(() => {
    window.electronAPI?.getModelDir?.().then(res => {
      if (res?.success) setModelDir(res);
    });
  }, []);

  // 載入本地 ASR 模型狀態
  const loadModelStatuses = async () => {
    try {
      const statuses = {};
      const dirsExist = {};
      const bundled = {};
      for (const m of LOCAL_ASR_MODELS) {
        try {
          const result = await window.electronAPI?.checkModelExists?.(m.id);
          statuses[m.id] = result?.models_downloaded === true;
          dirsExist[m.id] = result?.directory_exists === true || result?.models_downloaded === true;
          bundled[m.id] = result?.is_bundled === true;
        } catch (e) {
          statuses[m.id] = false;
          dirsExist[m.id] = false;
          bundled[m.id] = false;
        }
      }
      setModelStatuses(statuses);
      setModelDirsExist(dirsExist);
      setModelBundled(bundled);
    } catch (e) { /* ignore */ }
  };

  // 載入目前作用中的本地模型 & 雲端 ASR 設定
  const loadAsrConfig = async () => {
    try {
      const allSettings = await window.electronAPI?.getAllSettings?.();
      if (allSettings) {
        const activeType = allSettings.asr_model_type || 'paraformer';
        setSelectedModelType(activeType);

        // 雲端 ASR 設定
        let cloudCfg = DEFAULT_CLOUD_ASR_SETTINGS;
        try {
          const raw = allSettings.cloud_asr_settings;
          if (raw) {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            cloudCfg = normalizeCloudAsrSettings(parsed);
          }
        } catch (e) { /* ignore */ }
        setCloudAsrSettings(cloudCfg);

        // 若雲端啟用，切到 cloud 子分頁
        if (cloudCfg.enabled) setModelSubTab('cloud');
      }
    } catch (e) { /* ignore */ }
  };

  useEffect(() => {
    if (activeTab === 'models') {
      loadAsrConfig();
      loadModelStatuses();
    }
  }, [activeTab]);

  // 切到 AI 分頁時載入當日使用次數
  useEffect(() => {
    if (activeTab === 'ai') {
      window.electronAPI?.getAiUsage?.().then((res) => {
        if (res) setAiUsage(res);
      }).catch(() => {});
    }
  }, [activeTab]);

  // 監聽模型下載進度
  useEffect(() => {
    const cleanup = window.electronAPI?.onModelDownloadProgress?.((event, progress) => {
      if (progress?.progress != null) {
        setModelDownloadProgress(Math.round(progress.progress));
      }
    });
    return () => cleanup?.();
  }, []);

  // 切換本地模型（啟用）
  const activateLocalModel = async (modelId) => {
    try {
      await window.electronAPI?.switchModel?.(modelId);
      setSelectedModelType(modelId);
      // 同時關閉雲端 ASR
      const newCloudCfg = { ...cloudAsrSettings, enabled: false };
      setCloudAsrSettings(newCloudCfg);
      await window.electronAPI?.setSetting?.('cloud_asr_settings', JSON.stringify(newCloudCfg));
      // 重啟 Sherpa
      await window.electronAPI?.restartSherpaServer?.();
      toast.success(`已切換至本地模型：${LOCAL_ASR_MODELS.find(m => m.id === modelId)?.name || modelId}`);
    } catch (e) {
      toast.error('切換模型失敗: ' + e.message);
    }
  };

  // 下載本地模型
  const downloadLocalModel = async (modelId) => {
    try {
      setModelDownloading(modelId);
      setModelDownloadProgress(0);
      // 先切換到該模型讓 sherpaManager 知道要下載哪個
      await window.electronAPI?.switchModel?.(modelId);
      const result = await window.electronAPI?.downloadModels?.();
      if (result?.success) {
        toast.success('模型下載完成');
        await loadModelStatuses();
      } else {
        toast.error('下載失敗: ' + (result?.error || '未知錯誤'));
      }
    } catch (e) {
      toast.error('下載失敗: ' + e.message);
    } finally {
      setModelDownloading(null);
      setModelDownloadProgress(0);
      // 若原本有選其他模型，恢復
      await loadAsrConfig();
    }
  };

  // 刪除本地模型（二次確認）
  const deleteLocalModel = async (modelId) => {
    const modelName = LOCAL_ASR_MODELS.find(m => m.id === modelId)?.name || modelId;
    if (!window.confirm(`確定要刪除「${modelName}」模型檔案嗎？`)) return;
    if (!window.confirm(`再次確認：刪除後需要重新下載才能使用「${modelName}」，確定要刪除嗎？`)) return;
    try {
      setModelDeleting(modelId);
      const result = await window.electronAPI?.deleteModelFiles?.(modelId);
      if (result?.success !== false) {
        toast.success('模型已刪除');
        await loadModelStatuses();
      } else {
        toast.error('刪除失敗: ' + (result?.error || '未知錯誤'));
      }
    } catch (e) {
      toast.error('刪除失敗: ' + e.message);
    } finally {
      setModelDeleting(null);
    }
  };

  // 變更模型目錄：選新目錄 → 若有模型需搬移則詢問 → 搬移/切換
  const handleChangeModelDir = async () => {
    try {
      const result = await window.electronAPI?.changeModelDir?.();
      if (!result?.success) {
        if (!result?.canceled) toast.error('變更模型目錄失敗');
        return;
      }
      if (result.needConfirm) {
        const modelList = result.pendingModels.join('\n');
        const migrate = window.confirm(
          `發現 ${result.pendingModels.length} 個已下載模型，是否搬移到新目錄？\n\n${modelList}\n\n（選擇「確定」搬移模型並切換目錄，選擇「取消」保留在原處且維持原目錄）`
        );
        if (migrate) {
          const migrateResult = await window.electronAPI?.confirmMigrateModels?.(result.newDir, true);
          if (migrateResult?.success) {
            const failed = migrateResult.failedModels?.length ? `（${migrateResult.failedModels.length} 個失敗）` : '';
            toast.success(`已搬移 ${migrateResult.movedModels?.length ?? 0} 個模型${failed}`);
            if (migrateResult.failedModels?.length) {
              toast.warning(`搬移失敗：${migrateResult.failedModels.join('、')}`);
            }
          }
        } else {
          toast.info('未搬移模型，目錄保持原狀');
        }
      } else {
        toast.info(result.message || '目錄已變更');
      }
      // 重新載入目錄狀態與模型狀態
      if (window.electronAPI?.getModelDir) {
        const dir = await window.electronAPI.getModelDir();
        if (dir?.success) setModelDir(dir);
      }
      await loadModelStatuses();
    } catch (e) {
      toast.error('變更模型目錄失敗: ' + e.message);
    }
  };

  // 切換到雲端 ASR
  const activateCloudAsr = async (newCfg) => {
    try {
      const cfg = newCfg || cloudAsrSettings;
      const updatedCfg = { ...cfg, enabled: true };
      setCloudAsrSettings(updatedCfg);
      await window.electronAPI?.setSetting?.('cloud_asr_settings', JSON.stringify(updatedCfg));
      toast.success('已切換至雲端 ASR 辨識');
    } catch (e) {
      toast.error('切換失敗: ' + e.message);
    }
  };

  // 停用雲端 ASR（改回本地）
  const deactivateCloudAsr = async () => {
    try {
      const updatedCfg = { ...cloudAsrSettings, enabled: false };
      setCloudAsrSettings(updatedCfg);
      await window.electronAPI?.setSetting?.('cloud_asr_settings', JSON.stringify(updatedCfg));
      toast.success('已切換回本地辨識模型');
    } catch (e) {
      toast.error('切換失敗: ' + e.message);
    }
  };

  // 更新雲端 ASR 設定並存檔
  const updateCloudAsrSetting = async (key, value) => {
    let nextSettings = { ...cloudAsrSettings, [key]: value };
    if (key === 'provider' && value !== cloudAsrSettings.provider) {
      // 切換服務商時清空模型，避免把上一個服務商的模型名稱送給新服務商
      nextSettings = { ...nextSettings, model: '' };
    }
    const updated = key === 'gemini_mode'
      ? updateGeminiMode(cloudAsrSettings, value)
      : key === 'provider' && value === 'gemini_transcribe'
        ? normalizeCloudAsrSettings(nextSettings)
        : nextSettings;
    setCloudAsrSettings(updated);
    try {
      await window.electronAPI?.setSetting?.('cloud_asr_settings', JSON.stringify(updated));
    } catch (e) { /* ignore */ }
  };

  // 雲端 ASR 連線測試
  const testCloudAsrConnection = async () => {
    try {
      setCloudAsrTesting(true);
      setCloudAsrTestResult(null);
      const result = await window.electronAPI?.testCloudAsrConnection?.(cloudAsrSettings);
      setCloudAsrTestResult(result);
      if (result?.success) {
        toast.success('雲端 ASR 連線成功');
      } else {
        toast.error('連線失敗: ' + (result?.error || '未知錯誤'));
      }
    } catch (e) {
      const error = cloudAsrTestError(e);
      setCloudAsrTestResult({ success: false, error });
      toast.error(error);
    } finally {
      setCloudAsrTesting(false);
    }
  };

  // 列出可選的麥克風（已授權的話會有名稱；沒授權則只有編號）
  useEffect(() => {
    const loadMics = async () => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const devices = await navigator.mediaDevices.enumerateDevices();
        setMicDevices(devices.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications'));
      } catch (e) { /* ignore */ }
    };
    loadMics();
    navigator.mediaDevices?.addEventListener?.('devicechange', loadMics);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', loadMics);
  }, []);

  useEffect(() => {
    const stopMicMonitor = () => {
      if (micMonitorRef.current.raf) cancelAnimationFrame(micMonitorRef.current.raf);
      micMonitorRef.current.raf = 0;
      if (micMonitorRef.current.stream) {
        micMonitorRef.current.stream.getTracks().forEach((track) => track.stop());
      }
      micMonitorRef.current.stream = null;
      if (micMonitorRef.current.context) {
        micMonitorRef.current.context.close().catch(() => {});
      }
      micMonitorRef.current.context = null;
      setMicMonitorActive(false);
      setMicMonitorLevel(0);
    };

    if (activeTab !== 'general') {
      stopMicMonitor();
      return stopMicMonitor;
    }

    let cancelled = false;

    const startMicMonitor = async () => {
      stopMicMonitor();
      setMicMonitorError("");

      if (!navigator.mediaDevices?.getUserMedia) {
        setMicMonitorError(t('settings.micLevelUnsupported'));
        return;
      }

      const audioConstraints = {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: settings.mic_auto_gain !== false,
      };
      if (settings.mic_device_id) {
        audioConstraints.deviceId = { exact: settings.mic_device_id };
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContextClass();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);

        const samples = new Uint8Array(analyser.fftSize);
        micMonitorRef.current = { ...micMonitorRef.current, context: audioContext, stream };
        setMicMonitorActive(true);

        const tick = () => {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) {
            const centered = (sample - 128) / 128;
            sum += centered * centered;
          }
          const rms = Math.sqrt(sum / samples.length);
          setMicMonitorLevel(Math.min(1, rms * 8));
          micMonitorRef.current.raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        if (!cancelled) {
          setMicMonitorError(t('settings.micLevelUnavailable'));
        }
      }
    };

    startMicMonitor();

    return () => {
      cancelled = true;
      stopMicMonitor();
    };
  }, [activeTab, settings.mic_device_id, settings.mic_auto_gain, t]);

  const selectedMic = micDevices.find((device) => device.deviceId === settings.mic_device_id);
  const selectedMicLabel = settings.mic_device_id
    ? selectedMic?.label || t('settings.micDeviceUnknown')
    : t('settings.micDeviceDefault');

  const loadSettings = async () => {
    try {
      setLoading(true);
      if (window.electronAPI) {
        const allSettings = await window.electronAPI.getAllSettings();
        const loadedSettings = {
          ai_api_key: allSettings.ai_api_key || "",
          ai_base_url: allSettings.ai_base_url || "https://api.openai.com/v1",
          ai_model: allSettings.ai_model || "gpt-4o-mini",
          enable_ai_optimization: allSettings.enable_ai_optimization === true,
          enable_notifications: allSettings.enable_notifications !== false,
          enable_streaming_mode: allSettings.enable_streaming_mode === true,
          language: allSettings.language || "zh-TW",
          convert_transcription: allSettings.convert_transcription !== false,
          asr_profile: allSettings.asr_profile || "standard",
          asr_acceleration: allSettings.asr_acceleration || "auto",
          mic_device_id: allSettings.mic_device_id || "",
          mic_auto_gain: allSettings.mic_auto_gain !== false,
          typeless_trigger: allSettings.typeless_trigger || "default",
          auto_format_lists: allSettings.auto_format_lists === true,
          convert_ordinal_numbers: allSettings.convert_ordinal_numbers !== false,
          auto_line_break: allSettings.auto_line_break === true,
          save_audio: allSettings.save_audio !== false,
          audio_retention_days: allSettings.audio_retention_days != null ? Number(allSettings.audio_retention_days) : 30,
          auto_enter_after_paste: allSettings.auto_enter_after_paste === true,
          window_always_on_top: allSettings.window_always_on_top !== false,
          minimize_to_tray: allSettings.minimize_to_tray !== false,
          close_to_tray: allSettings.close_to_tray !== false,
          auto_start: allSettings.auto_start === true,
          auto_start_minimized: allSettings.auto_start_minimized !== false,
          recording_sound_enabled: allSettings.recording_sound_enabled !== false,
          sound_feedback_volume: (() => {
            const v = Number(allSettings.sound_feedback_volume);
            return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8;
          })(),
          sound_theme: allSettings.sound_theme || 'coin01',
          ai_sound_enabled: allSettings.ai_sound_enabled !== false,
          ai_sound_theme: allSettings.ai_sound_theme || 'coin02',
          ai_sound_volume: (() => {
            const v = Number(allSettings.ai_sound_volume);
            return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8;
          })(),
          mute_while_recording: allSettings.mute_while_recording === true,
          app_theme: allSettings.app_theme || 'system',
          window_opacity: (() => {
            const v = Number(allSettings.window_opacity);
            return Number.isFinite(v) && v > 0 ? Math.max(0.3, Math.min(1, v)) : 1;
          })()
        };
        setSettings(prev => ({ ...prev, ...loadedSettings }));

        // 載入多模型商設定
        const providerId = allSettings.ai_provider_id || 'openai';
        setSelectedProviderId(providerId);
        const keys = allSettings.ai_api_keys || {};
        const urls = allSettings.ai_base_urls || {};
        const models = allSettings.ai_models || {};
        setAiProviderKeys(keys);
        setAiProviderUrls(urls);
        setAiProviderModels(models);

        const predefinedModels = ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner", "gpt-4o", "gpt-4o-mini", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro", "gemini-3.5-flash", "qwen2.5", "qwen2.5:3b", "llama3.2"];
        setCustomModel(!predefinedModels.includes(loadedSettings.ai_model));
      }
    } catch (error) {
      console.error("加载设置失败:", error);
      toast.error(t('settings.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  // 保存设置
  const saveSettings = async () => {
    try {
      setSaving(true);
      if (window.electronAPI) {
        await window.electronAPI.setSetting('ai_provider_id', selectedProviderId);
        await window.electronAPI.setSetting('ai_api_keys', aiProviderKeys);
        await window.electronAPI.setSetting('ai_base_urls', aiProviderUrls);
        await window.electronAPI.setSetting('ai_models', aiProviderModels);
        await window.electronAPI.setSetting('enable_ai_optimization', settings.enable_ai_optimization);
        toast.success(t('settings.saveSuccess'));
      }
    } catch (error) {
      console.error("保存设置失败:", error);
      toast.error(t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // 靜默自動儲存 AI 設定（測試/選模型/輸入金鑰時呼叫）
  const autoSaveAI = async () => {
    if (!window.electronAPI) return;
    setAiSaveStatus('saving');
    try {
      await window.electronAPI.setSetting('ai_provider_id', selectedProviderId);
      await window.electronAPI.setSetting('ai_api_keys', aiProviderKeys);
      await window.electronAPI.setSetting('ai_base_urls', aiProviderUrls);
      await window.electronAPI.setSetting('ai_models', aiProviderModels);
      await window.electronAPI.setSetting('enable_ai_optimization', settings.enable_ai_optimization);
      setAiSaveStatus('saved');
    } catch (e) {
      console.error("Auto-save AI failed:", e);
      setAiSaveStatus(null);
    }
  };

  // 处理输入变化
  const handleInputChange = (key, value) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // 視窗透明度：即時套用 + 持久化（IPC 端會存設定）
  const handleOpacityChange = async (value) => {
    setSettings(prev => ({ ...prev, window_opacity: value }));
    try { await window.electronAPI?.setWindowOpacity?.(value); } catch (e) { /* ignore */ }
  };

  const handleVolumeChange = async (value) => {
    setSettings(prev => ({ ...prev, sound_feedback_volume: value }));
    try { await window.electronAPI?.setSetting?.('sound_feedback_volume', value); } catch (e) { /* ignore */ }
  };

  const handleAiVolumeChange = async (value) => {
    setSettings(prev => ({ ...prev, ai_sound_volume: value }));
    try { await window.electronAPI?.setSetting?.('ai_sound_volume', value); } catch (e) { /* ignore */ }
  };

  const handlePlayAiTestSound = async () => {
    try {
      const theme = settings.ai_sound_theme || 'coin02';
      const name = theme === 'marimba' ? 'marimba_start' : `${theme}_start`;
      const res = await window.electronAPI?.playSound(name);
      if (!res?.data) return;
      await tryUnlock();
      await playBase64Sound(res.data, res.mimeType, settings.ai_sound_volume);
    } catch (e) { console.warn('AI test sound error:', e); }
  };

  const handlePlayTestSound = async () => {
    try {
      const theme = settings.sound_theme || 'coin01';
      const name = theme === 'marimba' ? 'marimba_start' : `${theme}_start`;
      const res = await window.electronAPI?.playSound(name);
      if (!res?.data) return;
      await tryUnlock();
      await playBase64Sound(res.data, res.mimeType, settings.sound_feedback_volume);
    } catch (e) { console.warn('test sound error:', e); }
  };

  // 通用：改一個設定值並即時存檔（給下拉選單等用）
  const handleSettingChange = async (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    try { await window.electronAPI?.setSetting?.(key, value); } catch (e) { /* ignore */ }
  };

  const prepareStreamingModel = async () => {
    const status = await window.electronAPI?.checkStreamingModelFiles?.();
    setStreamingModelStatus(status || null);

    if (!status?.models_downloaded) {
      setStreamingModelDownloading(true);
      setStreamingModelProgress(0);
      setStreamingModelPhase('downloading');
      toast.info(t('settings.streamingModelDownloading'));
      const downloadResult = await window.electronAPI?.downloadStreamingModel?.();
      if (!downloadResult?.success) {
        toast.error(t('settings.streamingModelDownloadFailed', { error: downloadResult?.error || t('settings.testFailedDesc') }));
        return downloadResult || { success: false, error: t('settings.testFailedDesc') };
      }
      const nextStatus = await window.electronAPI?.checkStreamingModelFiles?.();
      setStreamingModelStatus(nextStatus || null);
      toast.success(t('settings.streamingModelDownloaded'));
    }

    setStreamingModelPhase('preloading');
    toast.info(t('settings.streamingPreloading'));
    return await window.electronAPI.preloadStreamingModel();
  };

  // 处理开关切换并自动保存
  const handleToggleChange = async (key, value) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));

    // 立即保存开关状态
    try {
      if (window.electronAPI) {
        await window.electronAPI.setSetting(key, value);
        // 根据不同的设置项显示不同的提示
        if (key === 'enable_ai_optimization') {
          toast.success(value ? t('notifications.aiEnabled') : t('notifications.aiDisabled'));
        } else if (key === 'enable_notifications') {
          toast.success(value ? t('notifications.enabled') : t('notifications.disabled'));
        } else if (key === 'enable_streaming_mode') {
          toast.success(value ? t('settings.streamingEnabled') : t('settings.streamingDisabled'));
          // 當啟用串流模式時，預載串流模型以減少首次錄音延遲
          if (value) {
            prepareStreamingModel()
              .then(result => {
                if (result.success) {
                  if (result.already_loaded) {
                    toast.success(t('settings.streamingModelReady'));
                  } else {
                    toast.success(t('settings.streamingPreloadComplete'));
                  }
                } else {
                  toast.error(t('settings.streamingPreloadFailed', { error: result.error || t('settings.testFailedDesc') }));
                }
              })
              .catch(err => {
                console.error('預載串流模型失敗:', err);
                toast.error(t('settings.streamingPreloadFailedSlow'));
              })
              .finally(() => {
                setStreamingModelDownloading(false);
                setStreamingModelProgress(0);
                setStreamingModelPhase(null);
              });
          }
        } else if (key === 'window_always_on_top') {
          // 視窗置頂需要即時應用
          await window.electronAPI.setAlwaysOnTop(value);
          toast.success(value ? t('settings.alwaysOnTopEnabled') : t('settings.alwaysOnTopDisabled'));
        } else if (key === 'minimize_to_tray') {
          toast.success(value ? t('settings.minimizeToTrayEnabled') : t('settings.minimizeToTrayDisabled'));
        } else if (key === 'close_to_tray') {
          toast.success(value ? t('settings.closeToTrayEnabled') : t('settings.closeToTrayDisabled'));
        } else if (key === 'recording_sound_enabled') {
          toast.success(value ? t('settings.soundEnabled') : t('settings.soundDisabled'));
        } else if (key === 'mute_while_recording') {
          toast.success(value ? t('settings.muteWhileRecordingEnabled') : t('settings.muteWhileRecordingDisabled'));
        } else if (key === 'auto_start') {
          toast.success(value ? t('settings.autoStartEnabled') : t('settings.autoStartDisabled'));
        } else if (key === 'auto_start_minimized') {
          toast.success(value ? t('settings.autoStartMinimizedEnabled') : t('settings.autoStartMinimizedDisabled'));
        }
        // 設定變更會透過 IPC 自動廣播到所有視窗
      }
    } catch (error) {
      console.error("保存设置失败:", error);
      toast.error(t('settings.saveFailed'));
    }
  };

  // 拉取目前 provider 的模型清單
  const fetchModelsForProvider = async (providerId) => {
    const provider = AI_PROVIDERS.find(p => p.id === providerId) || AI_PROVIDERS[0];
    const baseUrl = (aiProviderUrls[providerId] || provider.base_url).trim().replace(/\/$/, '');
    const apiKey = (aiProviderKeys[providerId] || '').trim();
    if (!apiKey && providerId !== 'custom') {
      toast.error('請先輸入 API Key');
      return;
    }
    setFetchingModels(true);
    try {
      const result = await window.electronAPI.fetchProviderModels({
        provider_id: providerId, base_url: baseUrl, api_key: apiKey
      });
      if (result.success) {
        setAiModelsList(result.models);
        toast.success(`取得 ${result.models.length} 個模型`);
      } else {
        toast.error('取得模型失敗: ' + (result.error || ''));
      }
    } catch (e) {
      toast.error('取得模型失敗: ' + e.message);
    } finally {
      setFetchingModels(false);
    }
  };

  // 切換模型商時自動拉取模型清單
  useEffect(() => {
    if (selectedProviderId && !loading) {
      // 切換廠商時先清空舊列表，避免顯示上一個廠商的模型
      setAiModelsList([]);
      fetchModelsForProvider(selectedProviderId);
    }
  }, [selectedProviderId, loading]);

  // 測試AI配置
  const testAIConfiguration = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      const provider = AI_PROVIDERS.find(p => p.id === selectedProviderId) || AI_PROVIDERS[0];
      const apiKey = (aiProviderKeys[selectedProviderId] || '').trim();
      const baseUrl = (aiProviderUrls[selectedProviderId] || provider.base_url).trim();
      const model = (aiProviderModels[selectedProviderId] || '').trim();

      if (!apiKey && selectedProviderId !== 'custom') {
        setTestResult({
          available: false,
          error: t('settings.configIncompleteDesc'),
          details: t('settings.configIncompleteDesc')
        });
        toast.error(t('settings.configIncomplete'), {
          description: t('settings.configIncompleteDesc')
        });
        return;
      }
      
      if (window.electronAPI) {
        const testConfig = {
          provider_id: selectedProviderId,
          api_key: apiKey,
          base_url: baseUrl || 'https://api.openai.com/v1',
          model: model || 'gpt-4o-mini'
        };
        
        const result = await window.electronAPI.checkAIStatus(testConfig);
        setTestResult(result);
        
        if (result.available) {
          toast.success(t('settings.testSuccess'), {
            description: t('settings.testSuccessDesc', { model: result.model || '?' })
          });
          // 測試通過 → 自動儲存設定
          try {
            await window.electronAPI.setSetting('ai_provider_id', selectedProviderId);
            await window.electronAPI.setSetting('ai_api_keys', aiProviderKeys);
            await window.electronAPI.setSetting('ai_base_urls', aiProviderUrls);
            await window.electronAPI.setSetting('ai_models', aiProviderModels);
            await window.electronAPI.setSetting('enable_ai_optimization', settings.enable_ai_optimization);
            toast.success(t('settings.saveSuccess'));
          } catch (e) {
            console.error("Auto-save after test failed:", e);
          }
        } else {
          toast.error(t('settings.testFailed'), {
            description: result.error || t('settings.testFailedDesc')
          });
        }
      }
    } catch (error) {
      console.error("测试AI配置失败:", error);
      setTestResult({
        available: false,
        error: error.message || t('settings.testFailed')
      });
      toast.error(t('settings.testFailed'), {
        description: error.message || t('settings.testFailedDesc')
      });
    } finally {
      setTesting(false);
    }
  };

  // 关闭窗口
  const handleClose = () => {
    if (window.electronAPI) {
      window.electronAPI.hideSettingsWindow();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[hsl(var(--background))] flex items-center justify-center">
        <div className="flex items-center space-x-3">
          <Loader2 className="w-6 h-6 animate-spin text-[hsl(var(--primary))]" />
          <span className="text-[hsl(var(--foreground))]">{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[hsl(var(--background))] flex flex-col">
      {/* 标题栏 - 固定（可拖曳，取代原生標題列）*/}
      <div className="draggable bg-[hsl(var(--glass-bg))] backdrop-blur-sm border-b border-[hsl(var(--border))] px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Settings className="w-5 h-5 text-[hsl(var(--theme-accent))]" />
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 chinese-title">{t('settings.title')}</h1>
          </div>
          <button
            onClick={handleClose}
            className="non-draggable p-2 hover:bg-[hsl(var(--accent))] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>
      </div>

      {/* 主要內容：左側分頁 + 右側內容 */}
      <div className="flex-1 flex min-h-0">
        {/* 側邊欄分頁 */}
        <nav className="w-48 flex-shrink-0 overflow-y-auto border-r border-[hsl(var(--border))] bg-[hsl(var(--glass-bg))] backdrop-blur-sm py-3">
          {SETTINGS_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'bg-[hsl(var(--theme-accent))]/10 text-[hsl(var(--theme-accent))] border-r-2 border-[hsl(var(--theme-accent))] font-semibold shadow-sm'
                    : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {t(tab.labelKey)}
              </button>
            );
          })}
        </nav>

        {/* 內容區 - 可滾動 */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-2xl mx-auto p-6 pb-8">
            {activeTab === 'permissions' && (
          <div className="bg-[hsl(var(--card))] rounded-xl shadow-lg border border-[hsl(var(--border))] mb-6">
            <div className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 chinese-title">
                  {t('settings.permissions')}
                </h2>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  {t('settings.permissionsDesc')}
                </p>
              </div>

              <div className="space-y-2">
                <PermissionCard
                  icon={Mic}
                  title={t('settings.micPermission')}
                  description={t('settings.micPermissionDesc')}
                  granted={micPermissionGranted}
                  onRequest={requestMicPermission}
                  buttonText={t('settings.testMic')}
                />

                <PermissionCard
                  icon={Shield}
                  title={t('settings.accessibilityPermission')}
                  description={t('settings.accessibilityPermissionDesc')}
                  granted={accessibilityPermissionGranted}
                  onRequest={testAccessibilityPermission}
                  buttonText={t('settings.testPermission')}
                />
              </div>
            </div>
          </div>

            )}

            {activeTab === 'general' && (<>
          {/* 一般设置部分 */}
          <div className="bg-[hsl(var(--card))] rounded-xl shadow-lg border border-[hsl(var(--border))] mb-6">
            <div className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 chinese-title">
                  {t('settings.generalSettings')}
                </h2>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  {t('settings.generalDescription')}
                </p>
              </div>

              <div className="space-y-4">
                {/* 语言选择 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-2">
                      <Globe className="w-4 h-4" />
                      {t('settings.language')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.languageDesc')}
                    </p>
                  </div>
                  <select
                    value={settings.language}
                    onChange={async (e) => {
                      const newLang = e.target.value;
                      handleInputChange('language', newLang);
                      await setLanguage(newLang);
                      if (window.electronAPI) {
                        await window.electronAPI.setSetting('language', newLang);
                      }
                      window.dispatchEvent(new Event('language-changed'));
                      // 使用新語言顯示通知，避免異步狀態更新導致顯示舊語言
                      const message =
                        newLang === 'zh-TW' ? '語言已切換' :
                        newLang === 'zh-CN' ? '语言已切换' :
                        'Language changed';
                      toast.success(message);
                    }}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    <option value="zh-TW">繁體中文</option>
                    <option value="zh-CN">简体中文</option>
                    <option value="en">English</option>
                  </select>
                </div>

                {/* 主題選擇 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-2">
                      <Palette className="w-4 h-4" />
                      {t('settings.appTheme')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.appThemeDesc')}
                    </p>
                  </div>
                  <select
                    value={settings.app_theme || 'system'}
                    onChange={async (e) => {
                      const theme = e.target.value;
                      handleInputChange('app_theme', theme);
                      if (window.electronAPI) {
                        await window.electronAPI.setSetting('app_theme', theme);
                      }
                      // 套用主題到 <html>
                      const root = document.documentElement;
                      root.classList.remove('dark', 'theme-dark-tech', 'theme-premium-light', 'theme-light-blue');
                      if (theme === 'system') {
                        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                          root.classList.add('dark');
                        }
                      } else {
                        root.classList.add(theme);
                      }
                      toast.success(t('settings.appThemeChanged'));
                    }}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    <option value="system">{t('settings.themeSystem')}</option>
                    <option value="theme-premium-light">{t('settings.themePremiumLight')}</option>
                    <option value="theme-dark-tech">{t('settings.themeDarkTech')}</option>
                    <option value="theme-light-blue">{t('settings.themeZenNatural')}</option>
                  </select>
                </div>

                {/* 麥克風選擇（空=系統預設） */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.micDevice')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.micDeviceDesc')}
                    </p>
                  </div>
                  <select
                    value={settings.mic_device_id || ''}
                    onChange={async (e) => {
                      const v = e.target.value;
                      handleInputChange('mic_device_id', v);
                      if (window.electronAPI) await window.electronAPI.setSetting('mic_device_id', v);
                      toast.success(t('settings.micDeviceChanged'));
                    }}
                    className="max-w-[55%] px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 truncate"
                  >
                    <option value="">{t('settings.micDeviceDefault')}</option>
                    {micDevices.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `${t('settings.micDevice')} ${i + 1}`}</option>
                    ))}
                  </select>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800/60">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Mic className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                        <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
                          {t('settings.micLevelTitle')}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                        {t('settings.micLevelSource', { device: selectedMicLabel })}
                      </p>
                    </div>
                    <span className={`shrink-0 text-xs font-medium ${
                      micMonitorError
                        ? 'text-amber-700 dark:text-amber-300'
                        : micMonitorActive
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {micMonitorError || (micMonitorActive ? t('settings.micLevelListening') : t('settings.micLevelStarting'))}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      className={`h-full rounded-full transition-[width,background-color] duration-100 ${
                        micMonitorLevel > 0.08
                          ? 'bg-emerald-500'
                          : 'bg-amber-400'
                      }`}
                      style={{ width: `${Math.max(4, Math.round(micMonitorLevel * 100))}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {t('settings.micLevelHint')}
                  </p>
                </div>

                {/* 自動增益（AGC）：好麥克風可關掉，避免靜音時放大噪音導致幻聽 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.micAgc')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.micAgcDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.mic_auto_gain !== false}
                    onClick={() => handleToggleChange('mic_auto_gain', !(settings.mic_auto_gain !== false))}
                    className={`${
                      settings.mic_auto_gain !== false ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.mic_auto_gain !== false ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 錄音觸發鍵（issue #12：右 Alt/右 Ctrl 會跟其他軟體衝突，可換成不衝突的鍵） */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.typelessTrigger')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.typelessTriggerDesc')}
                    </p>
                  </div>
                  <select
                    value={settings.typeless_trigger || 'default'}
                    onChange={async (e) => {
                      const v = e.target.value;
                      handleInputChange('typeless_trigger', v);
                      if (window.electronAPI?.setTypelessTrigger) await window.electronAPI.setTypelessTrigger(v);
                      toast.success(t('settings.typelessTriggerChanged'));
                    }}
                    className="max-w-[55%] px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    {runtimeInfo?.platform === 'darwin' ? (
                      // Mac 沒有右 Ctrl,且 default(右Alt+右Ctrl)在 Mac 等同右 Option,
                      // 所以只給「右 Option(預設)」+ 功能鍵,不列 Mac 上不存在/重複的選項。
                      <option value="default">{t('settings.typelessTriggerDefaultMac')}</option>
                    ) : (
                      <>
                        <option value="default">{t('settings.typelessTriggerDefault')}</option>
                        <option value="ctrlRight">{t('settings.typelessTriggerCtrlRight')}</option>
                        <option value="altRight">{t('settings.typelessTriggerAltRight')}</option>
                      </>
                    )}
                    <option value="f8">F8</option>
                    <option value="f9">F9</option>
                    <option value="f10">F10</option>
                  </select>
                </div>

                {/* 自動列點：把「第一…第二…第三…」轉成 1. 2. 3.（預設關，誤觸率偏高） */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.autoFormatLists')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.autoFormatListsDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.auto_format_lists === true}
                    onClick={() => handleToggleChange('auto_format_lists', !(settings.auto_format_lists === true))}
                    className={`${
                      settings.auto_format_lists === true ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.auto_format_lists === true ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 中文序數轉阿拉伯數字 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.convertOrdinalNumbers')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.convertOrdinalNumbersDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.convert_ordinal_numbers === true}
                    onClick={() => handleToggleChange('convert_ordinal_numbers', !(settings.convert_ordinal_numbers === true))}
                    className={`${
                      settings.convert_ordinal_numbers === true ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.convert_ordinal_numbers === true ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 依停頓自動分行（issue #17）：講話頓一下思考不自動斷行，預設關 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.autoLineBreak')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.autoLineBreakDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.auto_line_break === true}
                    onClick={() => handleToggleChange('auto_line_break', !(settings.auto_line_break === true))}
                    className={`${
                      settings.auto_line_break === true ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.auto_line_break === true ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 保存錄音檔 + 保留期限（建議 1：省 SSD、避免無限增長） */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.saveAudio')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.saveAudioDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.save_audio !== false}
                    onClick={() => handleToggleChange('save_audio', !(settings.save_audio !== false))}
                    className={`${
                      settings.save_audio !== false ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.save_audio !== false ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>
                {settings.save_audio !== false && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                        {t('settings.audioRetention')}
                      </label>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {t('settings.audioRetentionDesc')}
                      </p>
                    </div>
                    <select
                      value={String(settings.audio_retention_days ?? 30)}
                      onChange={async (e) => {
                        const v = Number(e.target.value);
                        handleInputChange('audio_retention_days', v);
                        if (window.electronAPI) await window.electronAPI.setSetting('audio_retention_days', v);
                        toast.success(t('settings.audioRetentionChanged'));
                      }}
                      className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      <option value="7">{t('settings.retentionDays', { n: 7 })}</option>
                      <option value="30">{t('settings.retentionDays', { n: 30 })}</option>
                      <option value="90">{t('settings.retentionDays', { n: 90 })}</option>
                      <option value="0">{t('settings.retentionForever')}</option>
                    </select>
                  </div>
                )}

                {/* 效能模式：標準（最準）/ 快速（弱 CPU 機器） */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.asrProfile')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.asrProfileDesc')}
                    </p>
                  </div>
                  <select
                    value={settings.asr_profile || 'standard'}
                    onChange={async (e) => {
                      const v = e.target.value;
                      handleInputChange('asr_profile', v);
                      if (window.electronAPI) {
                        await window.electronAPI.setSetting('asr_profile', v);
                      }
                      toast.success(t('settings.asrProfileChanged'));
                    }}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    <option value="standard">{t('settings.asrProfileStandard')}</option>
                    <option value="fast">{t('settings.asrProfileFast')}</option>
                  </select>
                </div>

                {/* 加速模式：自動 / CPU / GPU */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.asrAcceleration')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.asrAccelerationDesc')}
                    </p>
                  </div>
                  <select
                    value={settings.asr_acceleration || 'auto'}
                    onChange={async (e) => {
                      const v = e.target.value;
                      handleInputChange('asr_acceleration', v);
                      if (window.electronAPI) {
                        await window.electronAPI.setSetting('asr_acceleration', v);
                      }
                      toast.success(t('settings.asrAccelerationChanged'));
                      // 僅在目前模型已下載（已啟用）時才重啟引擎，讓加速設定生效
                      try {
                        const activeType = selectedModelType || 'paraformer';
                        const status = await window.electronAPI?.checkModelExists?.(activeType);
                        if (status?.models_downloaded && window.electronAPI?.restartSherpaServer) {
                          await window.electronAPI.restartSherpaServer();
                        }
                      } catch (err) {
                        console.error('重啟引擎失敗（非阻擋）:', err);
                      }
                    }}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    <option value="auto">{t('settings.asrAccelerationAuto')}</option>
                    <option value="cpu">{t('settings.asrAccelerationCpu')}</option>
                    <option value="gpu">{t('settings.asrAccelerationGpu')}</option>
                  </select>
                </div>

                {/* 转换识别结果 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.convertTranscription')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.convertTranscriptionDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.convert_transcription}
                    onClick={() => handleToggleChange('convert_transcription', !settings.convert_transcription)}
                    className={`${
                      settings.convert_transcription ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.convert_transcription ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 通知开关 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label htmlFor="notifications-toggle" className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.notifications')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.notificationsDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.enable_notifications}
                    onClick={() => handleToggleChange('enable_notifications', !settings.enable_notifications)}
                    className={`${
                      settings.enable_notifications ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.enable_notifications ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 串流辨識模式開關 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label htmlFor="streaming-toggle" className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.streamingMode')}
                    </label>
                    <p className="text-xs text-orange-500 dark:text-orange-400 mt-0.5">
                      {t('settings.streamingModeDesc')}
                    </p>
                    {streamingModelStatus && (
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {streamingModelPhase === 'extracting'
                          ? t('settings.streamingModelExtracting')
                          : streamingModelPhase === 'verifying'
                            ? t('settings.streamingModelVerifying')
                            : streamingModelPhase === 'preloading'
                              ? t('settings.streamingModelPreloadingStatus')
                              : streamingModelDownloading
                                ? t('settings.streamingModelDownloadingProgress', { progress: Math.round(streamingModelProgress) })
                                : streamingModelStatus.models_downloaded
                                  ? t('settings.streamingModelPresent')
                                  : t('settings.streamingModelMissing')}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.enable_streaming_mode}
                    onClick={() => handleToggleChange('enable_streaming_mode', !settings.enable_streaming_mode)}
                    className={`${
                      settings.enable_streaming_mode ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.enable_streaming_mode ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

              </div>
            </div>
          </div>

          {/* 聲音回饋設定 */}
          <div className="bg-[hsl(var(--card))] rounded-xl shadow-lg border border-[hsl(var(--border))] mb-6">
            <div className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 chinese-title">
                  {t('settings.soundFeedback')}
                </h2>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  {t('settings.soundFeedbackDesc')}
                </p>
              </div>

              <div className="space-y-4">
                {/* 聲音回饋開關 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.soundFeedbackToggle')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.soundFeedbackToggleDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.recording_sound_enabled}
                    onClick={() => handleToggleChange('recording_sound_enabled', !settings.recording_sound_enabled)}
                    className={`${
                      settings.recording_sound_enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.recording_sound_enabled ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 音量滑桿（僅在音效啟用時顯示） */}
                {settings.recording_sound_enabled && (
                  <>
                    <div>
                      <div className="flex items-center justify-between mb-0.5">
                        <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                          {t('settings.soundFeedbackVolume')}
                        </label>
                        <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                          {Math.round(settings.sound_feedback_volume * 100)}%
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                        {t('settings.soundFeedbackVolumeDesc')}
                      </p>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        value={Math.round(settings.sound_feedback_volume * 100)}
                        onChange={(e) => handleVolumeChange(Number(e.target.value) / 100)}
                        className="w-full slider-accent cursor-pointer"
                      />
                    </div>

                    {/* 音效主題選擇 */}
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                          {t('settings.soundTheme')}
                        </label>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {t('settings.soundThemeDesc')}
                        </p>
                      </div>
                      <select
                        value={settings.sound_theme}
                        onChange={(e) => handleSettingChange('sound_theme', e.target.value)}
                        className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      >
                        <option value="marimba">Marimba</option>
                        <option value="coin01">Coin 01</option>
                        <option value="coin02">Coin 02</option>
                        <option value="coin03">Coin 03</option>
                        <option value="coin05">Coin 05</option>
                        <option value="coin06">Coin 06</option>
                        <option value="coin07">Coin 07</option>
                        <option value="coin08">Coin 08</option>
                        <option value="pickup01">Pickup 01</option>
                      </select>
                    </div>

                    {/* 測試音效按鈕 */}
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                          {t('settings.testSound')}
                        </label>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {t('settings.testSoundDesc')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handlePlayTestSound}
                        className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {t('settings.testSoundPlay')}
                      </button>
                    </div>
                  </>
                )}

                {/* AI 優化錄音音效（獨立於一般錄音音效） */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                        {t('settings.aiSoundToggle')}
                      </label>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {t('settings.aiSoundToggleDesc')}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.ai_sound_enabled}
                      onClick={() => handleToggleChange('ai_sound_enabled', !settings.ai_sound_enabled)}
                      className={`${
                        settings.ai_sound_enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                      } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                    >
                      <span
                        aria-hidden="true"
                        className={`${
                          settings.ai_sound_enabled ? 'translate-x-4' : 'translate-x-0'
                        } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                      />
                    </button>
                  </div>

                  {settings.ai_sound_enabled && (
                    <>
                      <div className="mt-3">
                        <div className="flex items-center justify-between mb-0.5">
                          <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                            {t('settings.aiSoundVolume')}
                          </label>
                          <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                            {Math.round(settings.ai_sound_volume * 100)}%
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                          {t('settings.aiSoundVolumeDesc')}
                        </p>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="5"
                          value={Math.round(settings.ai_sound_volume * 100)}
                          onChange={(e) => handleAiVolumeChange(Number(e.target.value) / 100)}
                          className="w-full slider-accent cursor-pointer"
                        />
                      </div>

                      <div className="flex items-center justify-between mt-3">
                        <div>
                          <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                            {t('settings.aiSoundTheme')}
                          </label>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {t('settings.aiSoundThemeDesc')}
                          </p>
                        </div>
                        <select
                          value={settings.ai_sound_theme}
                          onChange={(e) => handleSettingChange('ai_sound_theme', e.target.value)}
                          className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        >
                          <option value="marimba">Marimba</option>
                          <option value="coin01">Coin 01</option>
                          <option value="coin02">Coin 02</option>
                          <option value="coin03">Coin 03</option>
                          <option value="coin05">Coin 05</option>
                          <option value="coin06">Coin 06</option>
                          <option value="coin07">Coin 07</option>
                          <option value="coin08">Coin 08</option>
                          <option value="pickup01">Pickup 01</option>
                        </select>
                      </div>

                      <div className="flex items-center justify-between mt-3">
                        <div>
                          <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                            {t('settings.aiTestSound')}
                          </label>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {t('settings.aiTestSoundDesc')}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handlePlayAiTestSound}
                          className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {t('settings.testSoundPlay')}
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* 錄音時靜音系統音訊 */}
                <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.muteWhileRecording')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.muteWhileRecordingDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.mute_while_recording}
                    onClick={() => handleToggleChange('mute_while_recording', !settings.mute_while_recording)}
                    className={`${
                      settings.mute_while_recording ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.mute_while_recording ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 視窗控制設定 */}
          <div className="bg-[hsl(var(--card))] rounded-xl shadow-lg border border-[hsl(var(--border))] mb-6">
            <div className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 chinese-title">
                  {t('settings.windowControl')}
                </h2>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  {t('settings.windowControlDesc')}
                </p>
              </div>

              <div className="space-y-4">
                {/* 視窗置頂開關 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.alwaysOnTop')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.alwaysOnTopDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.window_always_on_top}
                    onClick={() => handleToggleChange('window_always_on_top', !settings.window_always_on_top)}
                    className={`${
                      settings.window_always_on_top ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.window_always_on_top ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 視窗透明度滑桿（迷你 / 一般面板共用） */}
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.windowOpacity')}
                    </label>
                    <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                      {Math.round((settings.window_opacity ?? 1) * 100)}%
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    {t('settings.windowOpacityDesc')}
                  </p>
                  <input
                    type="range"
                    min="30"
                    max="100"
                    step="5"
                    value={Math.round((settings.window_opacity ?? 1) * 100)}
                    onChange={(e) => handleOpacityChange(Number(e.target.value) / 100)}
                    className="w-full slider-accent cursor-pointer"
                  />
                </div>

                {/* 縮小到托盤開關 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.minimizeToTray')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.minimizeToTrayDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.minimize_to_tray}
                    onClick={() => handleToggleChange('minimize_to_tray', !settings.minimize_to_tray)}
                    className={`${
                      settings.minimize_to_tray ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.minimize_to_tray ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 關閉到托盤開關 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.closeToTray')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.closeToTrayDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.close_to_tray}
                    onClick={() => handleToggleChange('close_to_tray', !settings.close_to_tray)}
                    className={`${
                      settings.close_to_tray ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.close_to_tray ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 開機自動啟動 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.autoStart')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.autoStartDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.auto_start}
                    onClick={() => handleToggleChange('auto_start', !settings.auto_start)}
                    className={`${
                      settings.auto_start ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.auto_start ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 開機自啟動時縮到托盤（子選項，需先啟用 auto_start） */}
                <div className={`flex items-center justify-between pl-6 ${!settings.auto_start ? 'opacity-40 pointer-events-none' : ''}`}>
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.autoStartMinimized')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.autoStartMinimizedDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.auto_start_minimized}
                    onClick={() => handleToggleChange('auto_start_minimized', !settings.auto_start_minimized)}
                    className={`${
                      settings.auto_start_minimized ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.auto_start_minimized ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 錄音完成後動作設定 */}
          <div className="bg-[hsl(var(--card))] rounded-xl shadow-lg border border-[hsl(var(--border))] mb-6">
            <div className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 chinese-title">
                  {t('settings.afterRecording')}
                </h2>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  {t('settings.afterRecordingDesc')}
                </p>
              </div>

              <div className="space-y-4">
                {/* 自動貼上：已固定開啟（不再提供開關，避免關掉後 TypeLess 失效） */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.autoPaste')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.autoPasteDesc')}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-green-600 dark:text-green-400 whitespace-nowrap">{t('settings.alwaysOn')}</span>
                </div>

                {/* 貼上後自動送出開關（完全信任模式） */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.autoEnter')}
                    </label>
                    <p className="text-xs text-orange-500 dark:text-orange-400 mt-0.5">
                      {t('settings.autoEnterDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.auto_enter_after_paste}
                    onClick={() => handleToggleChange('auto_enter_after_paste', !settings.auto_enter_after_paste)}
                    className={`${
                      settings.auto_enter_after_paste ? 'bg-orange-500' : 'bg-gray-300 dark:bg-gray-600'
                    } cursor-pointer relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.auto_enter_after_paste ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 操作模式 / 朗讀設定 */}
          <div className="bg-[hsl(var(--card))] rounded-xl shadow-lg border border-[hsl(var(--border))] mb-6">
            <div className="p-6 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 chinese-title">
                    {t('settings.commandSection')}
                  </h2>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {t('settings.commandSectionDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => window.electronAPI?.openNotes?.()}
                  className="shrink-0 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  {t('settings.openNotes')}
                </button>
              </div>

              {/* 朗讀語音 */}
              <div>
                <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {t('settings.ttsVoice')}
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-1.5">
                  {t('settings.ttsVoiceDesc')}
                </p>
                <select
                  value={settings.tts_voice || 'zh-TW-HsiaoChenNeural'}
                  onChange={(e) => handleSettingChange('tts_voice', e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  <option value="zh-TW-HsiaoChenNeural">{t('settings.ttsVoiceHsiaoChen')}</option>
                  <option value="zh-TW-HsiaoYuNeural">{t('settings.ttsVoiceHsiaoYu')}</option>
                  <option value="zh-TW-YunJheNeural">{t('settings.ttsVoiceYunJhe')}</option>
                </select>
              </div>

              {/* 朗讀語速 */}
              <div>
                <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {t('settings.ttsRate')}
                </label>
                <select
                  value={settings.tts_rate || '+0%'}
                  onChange={(e) => handleSettingChange('tts_rate', e.target.value)}
                  className="mt-1.5 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  <option value="-25%">{t('settings.ttsRateSlow')}</option>
                  <option value="+0%">{t('settings.ttsRateNormal')}</option>
                  <option value="+25%">{t('settings.ttsRateFast')}</option>
                </select>
              </div>

              {/* 自由指令開關 */}
              <div className="flex items-center justify-between">
                <div className="pr-3">
                  <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {t('settings.freeformCommand')}
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {t('settings.freeformCommandDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.command_freeform_enabled !== false}
                  onClick={() => handleToggleChange('command_freeform_enabled', settings.command_freeform_enabled === false)}
                  className={`${
                    settings.command_freeform_enabled !== false ? 'bg-sky-500' : 'bg-gray-300 dark:bg-gray-600'
                  } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none`}
                >
                  <span
                    aria-hidden="true"
                    className={`${
                      settings.command_freeform_enabled !== false ? 'translate-x-4' : 'translate-x-0'
                    } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                  />
                </button>
              </div>
            </div>
          </div>

            </>)}

            {activeTab === 'history' && (
          <div className="bg-[hsl(var(--card))] rounded-xl shadow-lg border border-[hsl(var(--border))]">
            <div className="p-5 h-[calc(100vh-7rem)]">
              <HistoryView />
            </div>
          </div>
            )}

            {activeTab === 'hotkeys' && (
          <div className="bg-[hsl(var(--card))] rounded-xl shadow-lg border border-[hsl(var(--border))] mb-6">
            <div className="p-6">
              <HotkeySettings />
            </div>
          </div>

            )}

            {activeTab === 'hotwords' && (
          <div className="bg-[hsl(var(--card))] rounded-xl shadow-lg border border-[hsl(var(--border))] mb-6">
            <div className="p-6">
              <HotwordsManager t={t} />
            </div>
          </div>

            )}

            {activeTab === 'dictionary' && (
          <div className="bg-[hsl(var(--card))] rounded-xl shadow-lg border border-[hsl(var(--border))] mb-6">
            <div className="p-6">
              <DictionaryManager t={t} />
            </div>
          </div>

            )}

            {activeTab === 'emoji' && (
          <div className="bg-[hsl(var(--card))] rounded-xl shadow-lg border border-[hsl(var(--border))] mb-6">
            <div className="p-6">
              <EmojiManager t={t} />
            </div>
          </div>

            )}

            {/* ===== 模型選擇分頁 ===== */}
            {activeTab === 'models' && (
              <div className="bg-[hsl(var(--card))] rounded-xl shadow-lg border border-[hsl(var(--border))]">
                {/* 子分頁標籤 */}
                <div className="flex border-b border-gray-200 dark:border-gray-700">
                  <button
                    onClick={async () => { setModelSubTab('local'); await deactivateCloudAsr(); }}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                      modelSubTab === 'local'
                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-b-2 border-blue-500'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <Cpu className="w-4 h-4" />
                    本地語音辨識模型
                    {!cloudAsrSettings.enabled && <span className="ml-1 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded-full">使用中</span>}
                  </button>
                  <button
                    onClick={() => setModelSubTab('cloud')}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                      modelSubTab === 'cloud'
                        ? 'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 border-b-2 border-sky-500'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <Globe className="w-4 h-4" />
                    雲端服務 ASR 模型
                    {cloudAsrSettings.enabled && <span className="ml-1 text-xs bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 px-1.5 py-0.5 rounded-full">使用中</span>}
                  </button>
                </div>

                <div className="p-5">

                  {/* ── 本地模型子分頁 ── */}
                  {modelSubTab === 'local' && (
                    <div className="space-y-3">
                      {cloudAsrSettings.enabled && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-300">
                          <WifiOff className="w-4 h-4 flex-shrink-0" />
                          <span>目前使用雲端 ASR，切換至本地模型時雲端將自動停用。</span>
                        </div>
                      )}
                      {LOCAL_ASR_MODELS.map((model) => {
                        const isDownloaded = modelStatuses[model.id];
                        const hasDir = modelDirsExist[model.id];
                        const isActive = selectedModelType === model.id && !cloudAsrSettings.enabled;
                        const isDownloadingThis = modelDownloading === model.id;
                        const isDeletingThis = modelDeleting === model.id;
                        const isBundled = modelBundled[model.id];
                        return (
                          <div
                            key={model.id}
                            className={`rounded-xl border p-4 transition-all ${
                              isActive
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{model.name}</span>
                                  <span className="text-xs text-gray-400 dark:text-gray-500">{model.size}</span>
                                  {isActive && (
                                    <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">目前使用中</span>
                                  )}
                                  {isBundled && (
                                    <span className="text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">內建</span>
                                  )}
                                  {isDownloaded && !isActive && !isBundled && (
                                    <span className="text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">已下載</span>
                                  )}
                                  {!isDownloaded && !isDownloadingThis && (
                                    <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">未下載</span>
                                  )}
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{model.description}</p>
                                {isDownloadingThis && (
                                  <div className="mt-2">
                                    <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 mb-1">
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                      下載中 {modelDownloadProgress}%
                                    </div>
                                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                                      <div
                                        className="bg-blue-500 h-1.5 rounded-full transition-all"
                                        style={{ width: `${modelDownloadProgress}%` }}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {!isDownloaded && !isDownloadingThis && (
                                  <button
                                    onClick={() => downloadLocalModel(model.id)}
                                    disabled={!!modelDownloading}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg transition-colors"
                                  >
                                    <Download className="w-3 h-3" />
                                    下載
                                  </button>
                                )}
                                {isDownloaded && !isActive && (
                                  <button
                                    onClick={() => activateLocalModel(model.id)}
                                    disabled={!!modelDownloading}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white rounded-lg transition-colors"
                                  >
                                    <Play className="w-3 h-3" />
                                    啟用
                                  </button>
                                )}
                                {(isDownloaded || hasDir) && !isBundled && (
                                  <button
                                    onClick={() => deleteLocalModel(model.id)}
                                    disabled={isDeletingThis || !!modelDownloading}
                                    className="flex items-center gap-1 px-2 py-1.5 text-xs bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded-lg transition-colors"
                                  >
                                    {isDeletingThis ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                    刪除
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => window.electronAPI?.openDefaultModelDir?.()}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                          <FolderOpen className="w-3 h-3" />
                          打開模型目錄
                        </button>
                        <button
                          onClick={handleChangeModelDir}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                          <FolderOpen className="w-3 h-3" />
                          變更模型目錄
                        </button>
                      </div>
                      {modelDir.currentDir && (
                        <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500 truncate" title={modelDir.currentDir}>
                          {modelDir.isCustom ? '自訂' : '預設'}：{modelDir.currentDir}
                        </p>
                      )}
                    </div>
                  )}

                  {/* ── 雲端 ASR 子分頁 ── */}
                  {modelSubTab === 'cloud' && (
                    <div className="space-y-4">
                      {/* 互斥防呆提示 */}
                      {!cloudAsrSettings.enabled && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-300">
                          <Cpu className="w-4 h-4 flex-shrink-0" />
                          <span>目前使用本地模型。啟用雲端 ASR 後，本地模型將自動暫停。</span>
                        </div>
                      )}
                      {cloudAsrSettings.enabled && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 text-sm text-sky-700 dark:text-sky-300">
                          <Wifi className="w-4 h-4 flex-shrink-0" />
                          <span>雲端 ASR 辨識已啟用。</span>
                          <button
                            onClick={deactivateCloudAsr}
                            className="ml-auto text-xs underline hover:no-underline"
                          >
                            切回本地模型
                          </button>
                        </div>
                      )}

                      {/* 服務商選擇 */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">服務商</label>
                        <select
                          value={cloudAsrSettings.provider}
                          onChange={(e) => updateCloudAsrSetting('provider', e.target.value)}
                          className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2"
                        >
                          <option value="openai">OpenAI (Whisper API)</option>
                          <option value="groq">Groq (Whisper Ultra-fast)</option>
                          <option value="deepgram">Deepgram Nova</option>
                          <option value="assemblyai">AssemblyAI</option>
                          <option value="gemini_transcribe">Google (Gemini Transcribe)</option>
                          <option value="custom">Custom（相容 OpenAI 格式）</option>
                        </select>
                      </div>

                      {/* API Key */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">API 金鑰</label>
                        <input
                          type="password"
                          value={(cloudAsrSettings.api_keys && cloudAsrSettings.api_keys[cloudAsrSettings.provider]) || ''}
                          onChange={(e) => updateCloudAsrSetting('api_keys', { ...(cloudAsrSettings.api_keys || {}), [cloudAsrSettings.provider]: e.target.value })}
                          placeholder="sk-..."
                          className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2"
                        />
                      </div>

                      {/* Base URL（Custom 才顯示）*/}
                      {cloudAsrSettings.provider === 'custom' && (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Base URL</label>
                          <input
                            type="text"
                            value={cloudAsrSettings.base_url}
                            onChange={(e) => updateCloudAsrSetting('base_url', e.target.value)}
                            placeholder="https://api.example.com/v1"
                            className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2"
                          />
                        </div>
                      )}

                      {/* 模型 */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">辨識模型</label>
                        <input
                          type="text"
                          value={cloudAsrSettings.model}
                          onChange={(e) => updateCloudAsrSetting('model', e.target.value)}
                          placeholder={cloudAsrSettings.provider === 'openai' ? 'whisper-1' : cloudAsrSettings.provider === 'groq' ? 'whisper-large-v3-turbo' : cloudAsrSettings.provider === 'gemini_transcribe' ? 'gemini-3.5-transcribe' : ''}
                          className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2"
                        />
                      </div>

                      {/* ── Gemini Transcribe 專屬設定 ── */}
                      {cloudAsrSettings.provider === 'gemini_transcribe' && (
                        <div className="space-y-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                          {/* Gemini 模式：REST / Live */}
                          <div>
                            <label className="block text-xs font-medium text-blue-700 dark:text-blue-300 mb-1">Gemini 模式</label>
                            <select
                              value={cloudAsrSettings.gemini_mode || 'rest'}
                              onChange={(e) => updateCloudAsrSetting('gemini_mode', e.target.value)}
                              className="w-full text-sm rounded-lg border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2"
                            >
                              <option value="rest">REST（錄完再送）— gemini-3.5-transcribe</option>
                              <option value="live">Live（即時串流）— gemini-3.5-transcribe-live</option>
                            </select>
                            <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                              {cloudAsrSettings.gemini_mode === 'live'
                                ? '⚡ Live 模式：邊錄邊辨識，即時顯示文字，延遲極低。'
                                : '📝 REST 模式：錄完音訊後一次性送出辨識，穩定可靠。'}
                            </p>
                          </div>

                          {/* 轉錄模式：Smart / Verbatim */}
                          <div>
                            <label className="block text-xs font-medium text-blue-700 dark:text-blue-300 mb-1">轉錄模式</label>
                            <select
                              value={cloudAsrSettings.transcription_mode || 'smart'}
                              onChange={(e) => updateCloudAsrSetting('transcription_mode', e.target.value)}
                              className="w-full text-sm rounded-lg border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2"
                            >
                              <option value="smart">Smart（智慧模式）— 自動刪贅字、修正口誤、格式化</option>
                              <option value="verbatim">Verbatim（逐字稿）— 保留所有口語細節</option>
                            </select>
                          </div>

                          {/* 語言提示 */}
                          <div>
                            <label className="block text-xs font-medium text-blue-700 dark:text-blue-300 mb-1">語言（選填）</label>
                            <select
                              value={cloudAsrSettings.language_code || ''}
                              onChange={(e) => updateCloudAsrSetting('language_code', e.target.value)}
                              className="w-full text-sm rounded-lg border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2"
                            >
                              <option value="">自動偵測</option>
                              <option value="zh-TW">繁體中文 (zh-TW)</option>
                              <option value="zh-CN">簡體中文 (zh-CN)</option>
                              <option value="en-US">英文 (en-US)</option>
                              <option value="ja-JP">日文 (ja-JP)</option>
                              <option value="ko-KR">韓文 (ko-KR)</option>
                              <option value="th-TH">泰文 (th-TH)</option>
                              <option value="vi-VN">越南文 (vi-VN)</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {/* 操作按鈕列 */}
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={testCloudAsrConnection}
                          disabled={cloudAsrTesting || !((cloudAsrSettings.api_keys && cloudAsrSettings.api_keys[cloudAsrSettings.provider]) || '')}
                          className="flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {cloudAsrTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube className="w-4 h-4" />}
                          連線測試
                        </button>
                        {!cloudAsrSettings.enabled ? (
                          <button
                            onClick={() => activateCloudAsr()}
                            disabled={!((cloudAsrSettings.api_keys && cloudAsrSettings.api_keys[cloudAsrSettings.provider]) || '')}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 text-white rounded-lg transition-colors"
                          >
                            <Wifi className="w-4 h-4" />
                            啟用雲端 ASR
                          </button>
                        ) : (
                          <button
                            onClick={deactivateCloudAsr}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors"
                          >
                            <WifiOff className="w-4 h-4" />
                            停用雲端 ASR
                          </button>
                        )}
                      </div>

                      {/* 連線測試結果 */}
                      {cloudAsrTestResult && (
                        <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                          cloudAsrTestResult.success
                            ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
                            : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                        }`}>
                          {cloudAsrTestResult.success
                            ? <CheckCircle className="w-4 h-4 flex-shrink-0" />
                            : <XCircle className="w-4 h-4 flex-shrink-0" />}
                          <span>{cloudAsrTestResult.success ? `連線成功${cloudAsrTestResult.text ? `，回傳：${cloudAsrTestResult.text}` : ''}` : `連線失敗：${cloudAsrTestResult.error}`}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'ai' && (
          <div className="bg-[hsl(var(--card))] rounded-xl shadow-lg border border-[hsl(var(--border))]">
            <div className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 chinese-title">
                  {t('settings.aiConfig')}
                </h2>
                 <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  {t('settings.aiConfigDesc')}
                </p>
              </div>

              {/* 今日 AI 優化次數 */}
              {aiUsage && Object.keys(aiUsage.usage || {}).length > 0 && (
                <div className="mb-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700">
                  <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    {t('settings.aiUsageToday')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(aiUsage.usage).map(([providerId, count]) => {
                      const provider = AI_PROVIDERS.find(p => p.id === providerId);
                      return (
                        <span key={providerId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-xs font-medium text-blue-700 dark:text-blue-300">
                          {provider ? provider.label : providerId}
                          <span className="tabular-nums">{count}{t('settings.aiUsageTimes')}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

             <div className="space-y-4">
               {/* AI优化开关 */}
               <div className="flex items-center justify-between pt-4">
                 <label htmlFor="ai-optimization-toggle" className="text-sm font-medium text-gray-800 dark:text-gray-200">
                   {t('settings.enableAI')}
                 </label>
                 <button
                   type="button"
                   role="switch"
                   aria-checked={settings.enable_ai_optimization}
                   onClick={() => handleToggleChange('enable_ai_optimization', !settings.enable_ai_optimization)}
                   className={`${
                     settings.enable_ai_optimization ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                   } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                 >
                   <span
                     aria-hidden="true"
                     className={`${
                       settings.enable_ai_optimization ? 'translate-x-4' : 'translate-x-0'
                     } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                   />
                 </button>
                </div>

                {/* 模型商選擇 */}
               <div>
                 <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                   {t('settings.aiProvider')}
                 </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedProviderId}
                      onChange={(e) => {
                        setSelectedProviderId(e.target.value);
                        autoSaveAI();
                      }}
                      className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                     {AI_PROVIDERS.map(p => (
                       <option key={p.id} value={p.id}>{p.label}</option>
                     ))}
                    </select>
                    {(() => {
                      const provider = AI_PROVIDERS.find(p => p.id === selectedProviderId);
                      if (!provider || !provider.keyUrl) return null;
                      return (
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            window.electronAPI?.openExternal(provider.keyUrl);
                          }}
                          className="shrink-0 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline whitespace-nowrap"
                          title={provider.keyUrl}
                        >
                          {t('settings.getApiKey')} ↗
                        </a>
                      );
                    })()}
                  </div>
               </div>

               {/* API Key */}
               <div>
                 <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                   {t('settings.apiKey')} {selectedProviderId !== 'custom' && '*'}
                 </label>
                  <div className="relative">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={aiProviderKeys[selectedProviderId] || ''}
                      onChange={(e) => setAiProviderKeys(prev => ({ ...prev, [selectedProviderId]: e.target.value }))}
                      onBlur={() => {
                        const apiKey = (aiProviderKeys[selectedProviderId] || '').trim();
                        const provider = AI_PROVIDERS.find(p => p.id === selectedProviderId) || AI_PROVIDERS[0];
                        const baseUrl = (aiProviderUrls[selectedProviderId] || provider.base_url).trim();
                        const model = (aiProviderModels[selectedProviderId] || '').trim();
                        if (apiKey && window.electronAPI) {
                          setTesting(true);
                          setAiSaveStatus(null);
                          window.electronAPI.checkAIStatus({
                            provider_id: selectedProviderId,
                            api_key: apiKey,
                            base_url: baseUrl || provider.base_url,
                            model: model
                          }).then(r => {
                            setTestResult(r);
                            if (r.available) {
                              toast.success(t('settings.testSuccess'));
                              autoSaveAI();
                            } else {
                              toast.error(t('settings.testFailed'), { description: r.error || t('settings.testFailedDesc') });
                            }
                          }).catch(() => {}).finally(() => setTesting(false));
                          // 填入 API Key 後自動重整模型清單（無需切換廠商）
                          fetchModelsForProvider(selectedProviderId);
                        }
                      }}
                      placeholder={
                        selectedProviderId === 'custom'
                          ? t('settings.apiKeyOptional')
                          : t('settings.apiKeyPlaceholder')
                      }
                      className="w-full px-3 py-2 pr-10 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                   <button
                     type="button"
                     onClick={() => setShowApiKey(!showApiKey)}
                     className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                   >
                     {showApiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                   </button>
                 </div>
                 <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                   {t('settings.apiKeyDesc')}
                 </p>
               </div>

               {/* Base URL */}
               <div>
                 <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                   {t('settings.baseUrl')}
                 </label>
                  <input
                    type="url"
                    value={aiProviderUrls[selectedProviderId] || AI_PROVIDERS.find(p => p.id === selectedProviderId)?.base_url || ''}
                    onChange={(e) => {
                      setAiProviderUrls(prev => ({ ...prev, [selectedProviderId]: e.target.value }));
                      autoSaveAI();
                    }}
                    placeholder="https://api.openai.com/v1"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                 <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                   {t('settings.baseUrlDesc')}
                 </p>
               </div>

                 {/* 模型選擇（下拉選單） */}
                 <div>
                   <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                     {t('settings.aiModel')}
                   </label>
                   <select
                     value={aiProviderModels[selectedProviderId] || ''}
                     onChange={(e) => {
                       const val = e.target.value;
                       setAiProviderModels(prev => ({ ...prev, [selectedProviderId]: val }));
                       // 選擇後自動測試
                       if (val && window.electronAPI) {
                         const provider = AI_PROVIDERS.find(p => p.id === selectedProviderId) || AI_PROVIDERS[0];
                         const apiKey = (aiProviderKeys[selectedProviderId] || '').trim();
                         const baseUrl = (aiProviderUrls[selectedProviderId] || provider.base_url).trim();
                         if (apiKey || selectedProviderId === 'custom') {
                           setTesting(true);
                           setAiSaveStatus(null);
                           window.electronAPI.checkAIStatus({
                             provider_id: selectedProviderId,
                             api_key: apiKey,
                             base_url: baseUrl || provider.base_url,
                             model: val
                           }).then(r => {
                             setTestResult(r);
                             if (r.available) {
                               toast.success(t('settings.testSuccess'), { description: `${val}` });
                               autoSaveAI();
                             }
                           }).catch(() => {}).finally(() => setTesting(false));
                         }
                       }
                     }}
                     className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                   >
                     <option value="">{fetchingModels ? t('settings.fetchModels') + '...' : t('settings.aiModel')}</option>
                     {aiModelsList.map(m => (
                       <option key={m} value={m}>{m}</option>
                     ))}
                   </select>
                   <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                     {t('settings.aiModelDesc')}
                   </p>
                 </div>
             </div>

              {/* 测试结果显示 */}
              {testResult && (
                <div className={`mt-4 p-3 rounded-lg border ${
                  testResult.available
                    ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                    : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
                }`}>
                  <div className="flex items-center space-x-2">
                    {testResult.available ? (
                      <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                    )}
                    <span className={`font-medium ${
                      testResult.available
                        ? 'text-green-800 dark:text-green-200'
                        : 'text-red-800 dark:text-red-200'
                    }`}>
                      {testResult.available ? t('settings.testSuccess') : t('settings.testFailed')}
                    </span>
                  </div>

                  {testResult.available && (
                    <div className="mt-2 space-y-1">
                      {testResult.model && (
                        <p className="text-xs text-green-700 dark:text-green-300">
                          {t('settings.testSuccessDesc', { model: testResult.model })}
                        </p>
                      )}
                      {testResult.details && (
                        <p className="text-xs text-green-700 dark:text-green-300">
                          {testResult.details}
                        </p>
                      )}
                      {testResult.response && (
                        <p className="text-xs text-green-700 dark:text-green-300">
                          AI: {testResult.response}
                        </p>
                      )}
                      {testResult.usage && (
                        <p className="text-xs text-green-600 dark:text-green-400">
                          Token: {testResult.usage.total_tokens || 'N/A'}
                        </p>
                      )}
                    </div>
                  )}

                  {!testResult.available && (
                    <div className="mt-2 space-y-1">
                      {testResult.error && (
                        <p className="text-xs text-red-700 dark:text-red-300">
                          {t('common.error')}: {testResult.error}
                        </p>
                      )}
                      {testResult.details && (
                        <p className="text-xs text-red-600 dark:text-red-400">
                          {testResult.details}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex flex-col">
                  <button
                    onClick={testAIConfiguration}
                    disabled={testing}
                    className="flex items-center space-x-2 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testing ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <TestTube className="w-3 h-3" />
                    )}
                    <span>{testing ? t('settings.testing') : t('settings.testConfig')}</span>
                  </button>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t('settings.testConfigDesc')}
                  </p>
                </div>

                <div className="flex items-center space-x-2 text-sm">
                  {testing && (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                      <span className="text-blue-600 dark:text-blue-400">{t('settings.testing')}</span>
                    </>
                  )}
                  {!testing && aiSaveStatus === 'saved' && (
                    <>
                      <CheckCircle className="w-3 h-3 text-green-600 dark:text-green-400" />
                      <span className="text-green-600 dark:text-green-400">{t('settings.statusSaved')}</span>
                    </>
                  )}
                  {!testing && aiSaveStatus === 'saving' && (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin text-gray-500" />
                      <span className="text-gray-500 dark:text-gray-400">{t('settings.saving')}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

            )}

            {activeTab === 'ai-style' && (
          <div className="bg-[hsl(var(--card))] rounded-xl shadow-lg border border-[hsl(var(--border))]">
            <div className="p-6">
              <AIStylePackManager t={t} />
            </div>
          </div>
            )}

            {activeTab === 'backup' && (
            <BackupPanel t={t} />
            )}

            {activeTab === 'about' && (
            <div className="space-y-4 max-w-xl">
              {/* 專案 */}
              <div className="bg-[hsl(var(--card))] rounded-xl shadow-lg border border-[hsl(var(--border))] p-5 text-center">
                <img
                  src="./icon.png"
                  alt={t('settings.aboutTab.logoAlt')}
                  className="w-20 h-20 mx-auto mb-3 rounded-2xl shadow-md"
                  draggable="false"
                />
                <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 brand-title">
                  {t('appName')} <span className="text-base font-normal text-gray-400">{t('settings.aboutTab.brandSub')}</span>
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('settings.aboutTab.tagline')}</p>
                <p className="text-[11px] text-gray-400 mt-2">{appVersion ? `v${appVersion} · ` : ''}Apache License 2.0</p>
              </div>

              {/* 作者 */}
              <div className="bg-[hsl(var(--card))] rounded-xl shadow-lg border border-[hsl(var(--border))] p-5">
                <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-line">{t('settings.aboutTab.authorPrefix')}<strong>{t('settings.aboutTab.authorName')}</strong>{t('settings.aboutTab.authorSuffix')}</p>
                <a href="https://github.com/Jeffrey0117/SpeakSlow" target="_blank" rel="noreferrer"
                   className="inline-block text-xs text-blue-500 hover:underline mt-2">
                  GitHub · Jeffrey0117/SpeakSlow
                </a>
              </div>

              {/* 致謝 */}
              <div className="bg-[hsl(var(--card))] rounded-xl shadow-lg border border-[hsl(var(--border))] p-5">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-1.5">
                  <Heart className="w-4 h-4 text-red-400" /> {t('settings.aboutTab.acknowledgements')}
                </h3>
                <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-2 leading-relaxed">
                  <li>• <a href="https://github.com/yan5xu/ququ" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">ququ (yan5xu)</a> — {t('settings.aboutTab.ackQuqu')}</li>
                  <li>• <a href="https://github.com/k2-fsa/sherpa-onnx" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">sherpa-onnx (k2-fsa)</a> — {t('settings.aboutTab.ackSherpa')}</li>
                  <li>• <a href="https://wisprflow.ai/" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">Wispr Flow</a> — {t('settings.aboutTab.ackWispr')}</li>
                </ul>
              </div>
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// 导出组件供App.jsx使用
export { SettingsPage };

// 如果是直接访问settings.html，则渲染应用
if (document.getElementById("settings-root")) {
  const root = ReactDOM.createRoot(document.getElementById("settings-root"));
  root.render(
    <LanguageProvider>
      <SettingsPage />
      <Toaster />
    </LanguageProvider>
  );
}
