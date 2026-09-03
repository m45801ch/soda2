const CONNECT_TIMEOUT_MS = 10_000;
const END_STREAM_TIMEOUT_MS = 15_000;

class GeminiTranscribeLiveClient {
  constructor({ apiKey, languageCode, transcriptionMode, customVocabulary, logger, WebSocketImpl }) {
    this.apiKey = apiKey;
    this.languageCode = languageCode || "";
    this.transcriptionMode = transcriptionMode || "smart";
    this.customVocabulary = customVocabulary || [];
    this.logger = logger;
    this.WebSocketImpl = WebSocketImpl;
    this.ws = null;
    this.connected = false;
    this.setupSent = false;
    this.setupComplete = false;
    this.onInterimText = null;
    this.onFinalText = null;
    this.onError = null;
    this.onClose = null;
    this._finalTexts = [];
    this._connectPromise = null;
    this._endStreamPromise = null;
    this._resolveEndStream = null;
    this._endStreamTimeout = null;
    this._endStreamSent = false;
  }

  connect() {
    if (this._connectPromise) return this._connectPromise;

    this._connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        this.ws?.close();
        finish(reject, new Error("Gemini Live setup acknowledgement timeout"));
      }, CONNECT_TIMEOUT_MS);
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this._connectPromise = null;
        callback(value);
      };

      try {
        const url = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=" + encodeURIComponent(this.apiKey);
        const WebSocketConstructor = this.WebSocketImpl || require("ws");
        const socket = this.WebSocketImpl ? WebSocketConstructor(url) : new WebSocketConstructor(url);
        this.ws = socket;
        socket.on("open", () => {
          if (this.ws !== socket) return;
          this.connected = true;
          this._sendSetup();
        });
        socket.on("message", (data) => {
          if (this.ws !== socket) return;
          let message;
          try {
            message = JSON.parse(data.toString());
          } catch (_) {
            this.logger?.warn?.("[GeminiLive] Ignoring malformed server message");
            return;
          }
          if (message.setupComplete) {
            this.setupComplete = true;
            finish(resolve);
          } else if (message.error) {
            const error = new Error(message.error.message || "Gemini Live setup failed");
            this._reportError(error);
            if (!this.setupComplete) finish(reject, error);
          } else {
            this._handleServerContent(message.serverContent);
          }
        });
        socket.on("error", (error) => {
          if (this.ws !== socket) return;
          this._reportError(error);
          if (!this.setupComplete) finish(reject, error);
        });
        socket.on("close", (code, reason) => {
          if (this.ws !== socket) return;
          this.connected = false;
          this.setupSent = false;
          this.setupComplete = false;
          if (!settled) finish(reject, new Error("Gemini Live socket closed before setup acknowledgement"));
          this._resolvePendingEndStream();
          this.onClose?.(code, reason?.toString?.() || "");
        });
      } catch (error) {
        finish(reject, error);
      }
    });
    return this._connectPromise;
  }

  _sendSetup() {
    if (this.setupSent) return;
    const inputAudioTranscription = {
      languageCodes: this.languageCode ? [this.languageCode] : [],
      mode: String(this.transcriptionMode).toUpperCase() === "VERBATIM" ? "VERBATIM" : "SMART",
    };
    if (this.customVocabulary.length) inputAudioTranscription.customVocabulary = this.customVocabulary;
    this.ws.send(JSON.stringify({
      setup: {
        model: "models/gemini-3.5-transcribe-live",
        generationConfig: { responseModalities: ["TEXT"] },
        inputAudioTranscription,
      },
    }));
    this.setupSent = true;
    this._finalTexts = [];
    this._endStreamSent = false;
  }

  sendAudioChunk(audioBase64) {
    if (!this.connected || !this.setupComplete) return;
    this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: audioBase64, mimeType: "audio/pcm;rate=16000" } } }));
  }

  endStream() {
    if (this._endStreamPromise) return this._endStreamPromise;
    if (this._endStreamSent) return Promise.resolve(this.getFinalText());
    if (!this.connected || !this.setupComplete) return Promise.resolve(this.getFinalText());
    this._endStreamPromise = new Promise((resolve) => {
      this._endStreamSent = true;
      this._resolveEndStream = () => resolve(this.getFinalText());
      this._endStreamTimeout = setTimeout(() => this._resolvePendingEndStream(), END_STREAM_TIMEOUT_MS);
      this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    });
    return this._endStreamPromise;
  }

  _handleServerContent(content) {
    if (!content) return;
    const interim = content.interimInputTranscription?.text;
    if (interim) this.onInterimText?.(interim);
    const final = content.inputTranscription?.text;
    if (final) {
      this._finalTexts.push(final);
      this.onFinalText?.(final);
    }
    if (content.turnComplete) this._resolvePendingEndStream();
  }

  _resolvePendingEndStream() {
    if (!this._resolveEndStream) return;
    clearTimeout(this._endStreamTimeout);
    const resolve = this._resolveEndStream;
    this._resolveEndStream = null;
    this._endStreamTimeout = null;
    this._endStreamPromise = null;
    resolve();
  }

  _reportError(error) {
    this.logger?.error?.("[GeminiLive] WebSocket error:", error.message);
    this.onError?.(error);
  }

  getFinalText() {
    return this._finalTexts.join("").trim();
  }

  disconnect() {
    const socket = this.ws;
    this.ws = null;
    this.connected = false;
    this.setupSent = false;
    this.setupComplete = false;
    this._resolvePendingEndStream();
    try {
      socket?.close();
    } catch (_) {
      // Closing an already-closed socket is harmless.
    }
  }

  isConnected() {
    return this.connected && this.setupComplete;
  }
}

module.exports = GeminiTranscribeLiveClient;
