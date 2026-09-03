const fs = require("fs");

/**
 * Cloud ASR Client
 * Handles transcription requests using cloud APIs (OpenAI, Groq, OpenRouter, Deepgram, Gemini, Hugging Face)
 */
class CloudAsrClient {
  static async transcribe(settings, audioBuffer) {
    const provider = (settings.provider || "groq").toLowerCase();
    // 各服務商各自記 key；舊版共用欄位當 fallback
    const apiKey = (settings.api_keys && settings.api_keys[settings.provider]) || settings.api_key || "";
    const model = settings.model || "whisper-large-v3";
    const customBaseUrl = settings.base_url || "";

    switch (provider) {
      case "groq":
      case "openai":
      case "openrouter":
      case "custom": {
        let url = "";
        if (provider === "groq") {
          url = "https://api.groq.com/openai/v1/audio/transcriptions";
        } else if (provider === "openai") {
          url = "https://api.openai.com/v1/audio/transcriptions";
        } else if (provider === "openrouter") {
          url = "https://openrouter.ai/api/v1/audio/transcriptions";
        } else {
          url = `${customBaseUrl.replace(/\/+$/, "")}/audio/transcriptions`;
        }

        const headers = {};
        if (apiKey) {
          headers["Authorization"] = `Bearer ${apiKey}`;
        }

        const formData = new FormData();
        const blob = new Blob([audioBuffer], { type: "audio/wav" });
        formData.append("file", blob, "audio.wav");
        formData.append("model", model);

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: formData,
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Cloud ASR Server (${provider}) returned error: ${errText}`);
        }

        const result = await response.json();
        return result.text || "";
      }

      case "deepgram": {
        const url = customBaseUrl ? customBaseUrl : `https://api.deepgram.com/v1/listen?model=${model}&smart_format=true`;
        const headers = {
          "Content-Type": "audio/wav",
        };
        if (apiKey) {
          headers["Authorization"] = `Token ${apiKey}`;
        }

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: audioBuffer,
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Deepgram API returned error: ${errText}`);
        }

        const result = await response.json();
        const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript;
        if (transcript === undefined) {
          throw new Error("Failed to parse Deepgram response: no transcript field found.");
        }
        return transcript || "";
      }

      case "gemini_transcribe": {
        // Gemini 3.5 Transcribe — 專用語音轉文字模型（REST，錄完再送）
        const actualModel = (settings.gemini_mode === "live" ? "gemini-3.5-transcribe-live" : "gemini-3.5-transcribe");
        const modelName = (settings.model || actualModel).trim();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const base64Audio = audioBuffer.toString("base64");

        // 轉錄模式：smart（智慧）/ verbatim（逐字）
        const transcribeMode = (settings.transcription_mode || "smart").toUpperCase();
        const languageCodes = settings.language_code ? [settings.language_code] : [];

        const body = {
          contents: [{
            parts: [
              {
                inlineData: {
                  mimeType: "audio/wav",
                  data: base64Audio
                }
              }
            ]
          }],
          generationConfig: {
            audioTranscriptionConfig: {
              mode: transcribeMode,
              languageCodes
            }
          }
        };

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Gemini Transcribe API returned error: ${errText}`);
        }

        const result = await response.json();
        // generateContent 回傳 text 或 candidates[0].content.parts[0].text
        const text = result.text || result.candidates?.[0]?.content?.parts?.[0]?.text;
        return (text || "").trim();
      }

      case "gemini": {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const base64Audio = audioBuffer.toString("base64");

        const body = {
          contents: [{
            parts: [
              {
                inlineData: {
                  mimeType: "audio/wav",
                  data: base64Audio
                }
              },
              {
                text: "Transcribe this audio precisely. Do not translate. Output ONLY the transcription text."
              }
            ]
          }]
        };

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Gemini API returned error: ${errText}`);
        }

        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        return (text || "").trim();
      }

      case "huggingface": {
        const url = customBaseUrl ? customBaseUrl : `https://api-inference.huggingface.co/models/${model}`;
        const headers = {
          "Content-Type": "audio/wav"
        };
        if (apiKey) {
          headers["Authorization"] = `Bearer ${apiKey}`;
        }

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: audioBuffer
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Hugging Face API returned error: ${errText}`);
        }

        const result = await response.json();
        return result.text || "";
      }

      default:
        throw new Error(`Unsupported cloud ASR provider: ${provider}`);
    }
  }
}

module.exports = CloudAsrClient;
