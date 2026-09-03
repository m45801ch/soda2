import React, { useEffect, useState } from "react";
import { useTranslation } from "../i18n";
import { indicatorClass, truncateLiveText } from "./typelessIndicatorLogic.js";

/**
 * TypeLess 錄音指示器組件（講話時跳出來的「藥丸」）
 * 一般聽寫：紅色「錄音中」。
 * 操作模式：淺藍 + 虛線框 +「聽指令」，一眼分辨你是在下指令而非聽寫。
 */
const TypelessIndicator = () => {
  const { t } = useTranslation();
  const [commandMode, setCommandMode] = useState(false);
  const [cloudAsrActive, setCloudAsrActive] = useState(false);
  const [aiOptimizeRecording, setAiOptimizeRecording] = useState(false);
  const [liveText, setLiveText] = useState('');

  useEffect(() => {
    let unsubStart = null;
    let unsubStop = null;
    if (window.electronAPI) {
      unsubStart = window.electronAPI.onAiOptimizeRecordingStart?.(() => setAiOptimizeRecording(true));
      unsubStop = window.electronAPI.onAiOptimizeRecordingStop?.(() => setAiOptimizeRecording(false));
    }
    return () => {
      if (typeof unsubStart === 'function') unsubStart();
      if (typeof unsubStop === 'function') unsubStop();
    };
  }, []);

  useEffect(() => {
    let unsub = null;
    window.electronAPI
      ?.getCommandMode?.()
      .then((v) => { if (typeof v === "boolean") setCommandMode(v); })
      .catch(() => {});
    unsub = window.electronAPI?.onCommandModeChanged?.((v) => setCommandMode(!!v));
    return () => { if (typeof unsub === "function") unsub(); };
  }, []);

  // 雲端 Live 即時文字 — 顯示最新一小段；開始/停止/取消錄音時清空
  useEffect(() => {
    const unsubs = [];
    const api = window.electronAPI;
    if (!api) return undefined;
    const reset = () => setLiveText('');
    if (typeof api.onTypelessStartRecording === 'function') unsubs.push(api.onTypelessStartRecording(reset));
    if (typeof api.onTypelessStopRecording === 'function') unsubs.push(api.onTypelessStopRecording(reset));
    if (typeof api.onTypelessCancelRecording === 'function') unsubs.push(api.onTypelessCancelRecording(reset));
    if (typeof api.onCloudLiveInterim === 'function') {
      unsubs.push(api.onCloudLiveInterim((text) => setLiveText(truncateLiveText(text || ''))));
    }
    if (typeof api.onCloudLiveFinal === 'function') {
      unsubs.push(api.onCloudLiveFinal((segment) => setLiveText((prev) => truncateLiveText((prev || '') + (segment || '')))));
    }
    return () => { for (const u of unsubs) { if (typeof u === 'function') u(); } };
  }, []);

  // 雲端 ASR 狀態 — 從 cloud_asr_settings 判斷
  useEffect(() => {
    const checkCloudAsr = async () => {
      try {
        const raw = await window.electronAPI?.getSetting?.('cloud_asr_settings', null);
        if (raw) {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          setCloudAsrActive(parsed?.enabled === true);
        } else {
          setCloudAsrActive(false);
        }
      } catch { setCloudAsrActive(false); }
    };
    checkCloudAsr();
    const unsub = window.electronAPI?.onSettingChanged?.((data) => {
      if (data?.key === 'cloud_asr_settings') {
        try {
          const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
          setCloudAsrActive(parsed?.enabled === true);
        } catch { setCloudAsrActive(false); }
      }
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  return (
    <div className="w-full h-full flex items-center justify-center">
      <div
        className={`pill-bounce backdrop-blur-sm rounded-full px-5 py-2 flex items-center gap-2.5 ${
          indicatorClass(aiOptimizeRecording, cloudAsrActive, commandMode)
        }`}
        >
          {cloudAsrActive && (<><div className="coin-particle" /><div className="coin-particle" /><div className="coin-particle" /></>)}
          {/* AI 優化錄音：金幣煙火 */}
          {aiOptimizeRecording && (
            <div className="ai-coin-burst">
              <div className="ai-coin-particle" />
              <div className="ai-coin-particle" />
              <div className="ai-coin-particle" />
              <div className="ai-coin-particle" />
              <div className="ai-coin-particle" />
              <div className="ai-coin-particle" />
            </div>
          )}
          {/* 靜止白點（不跳動）*/}
        <div className="w-3 h-3 bg-white rounded-full" />

        {/* 文字 */}
        <span className="text-white font-semibold text-[15px] whitespace-nowrap tracking-wide">
          {aiOptimizeRecording
            ? t("panel.aiOptimizeRecording")
            : commandMode ? t("panel.commandListening") : t("panel.recordingIndicator")}
        </span>
        {/* 雲端 Live 即時文字 */}
        {liveText ? (
          <span className="text-white/90 font-normal text-[12px] whitespace-nowrap tracking-wide max-w-[220px] overflow-hidden text-ellipsis">
            {liveText}
          </span>
        ) : null}

        {/* 聲波動畫 */}
        <div className="flex items-center gap-0.5">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="w-1 bg-white/80 rounded-full animate-pulse"
              style={{
                height: `${12 + Math.random() * 8}px`,
                animationDelay: `${i * 0.15}s`,
                animationDuration: "0.6s",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default TypelessIndicator;
