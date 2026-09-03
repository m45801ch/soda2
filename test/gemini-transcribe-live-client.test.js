const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

const GeminiTranscribeLiveClient = require("../src/helpers/geminiTranscribeLiveClient");

class FakeSocket {
  constructor() {
    this.handlers = new Map();
    this.sent = [];
    this.closed = false;
  }

  on(event, handler) {
    this.handlers.set(event, handler);
  }

  send(payload) {
    this.sent.push(payload);
  }

  open() {
    this.handlers.get("open")?.();
  }

  message(message) {
    this.handlers.get("message")?.(Buffer.from(JSON.stringify(message)));
  }

  error(error) {
    this.handlers.get("error")?.(error);
  }

  close(code = 1000, reason = "closed") {
    this.closed = true;
    this.handlers.get("close")?.(code, Buffer.from(reason));
  }
}

async function settles(promise) {
  const marker = Symbol("pending");
  const outcome = await Promise.race([promise.then(() => true, () => true), new Promise((resolve) => setImmediate(() => resolve(marker)))]);
  return outcome !== marker;
}

function createClient(socket) {
  return new GeminiTranscribeLiveClient({
    apiKey: "test",
    WebSocketImpl: () => socket,
  });
}

async function connect(socket, client = createClient(socket)) {
  const connecting = client.connect();
  socket.open();
  socket.message({ setupComplete: {} });
  await connecting;
  return client;
}

test("connect waits for setupComplete before resolving", async () => {
  const socket = new FakeSocket();
  const client = createClient(socket);
  const connecting = client.connect();

  socket.open();
  assert.equal(await settles(connecting), false);
  assert.equal(JSON.parse(socket.sent[0]).setup.model, "models/gemini-3.5-transcribe-live");

  socket.message({ setupComplete: {} });
  await connecting;
});

test("setup serializes default SMART transcription mode", async () => {
  const socket = new FakeSocket();
  const client = createClient(socket);
  const connecting = client.connect();

  socket.open();
  const setup = JSON.parse(socket.sent[0]).setup.inputAudioTranscription;
  socket.message({ setupComplete: {} });
  await connecting;
  assert.equal(setup.mode, "SMART");
});

test("setup serializes VERBATIM mode and custom vocabulary", async () => {
  const socket = new FakeSocket();
  const client = new GeminiTranscribeLiveClient({
    apiKey: "test",
    transcriptionMode: "verbatim",
    customVocabulary: ["Codex", "Gemini Live"],
    WebSocketImpl: () => socket,
  });
  const connecting = client.connect();

  socket.open();
  const setup = JSON.parse(socket.sent[0]).setup.inputAudioTranscription;
  socket.message({ setupComplete: {} });
  await connecting;
  assert.deepEqual(setup, {
    languageCodes: [],
    mode: "VERBATIM",
    customVocabulary: ["Codex", "Gemini Live"],
  });
});

test("connect rejects when the server reports a setup error", async () => {
  const socket = new FakeSocket();
  const client = createClient(socket);
  const connecting = client.connect();

  socket.open();
  socket.message({ error: { message: "setup denied" } });

  await assert.rejects(connecting, /setup denied/);
});

test("connect rejects when the socket closes before setup acknowledgement", async () => {
  const socket = new FakeSocket();
  const client = createClient(socket);
  const connecting = client.connect();

  socket.open();
  socket.close(1006, "lost");

  await assert.rejects(connecting, /closed before setup/i);
});

test("sendAudioChunk sends PCM only after setup acknowledgement", async () => {
  const socket = new FakeSocket();
  const client = createClient(socket);
  const connecting = client.connect();

  socket.open();
  client.sendAudioChunk("before-ready");
  assert.equal(socket.sent.length, 1);
  socket.message({ setupComplete: {} });
  await connecting;

  client.sendAudioChunk("pcm-base64");
  assert.deepEqual(JSON.parse(socket.sent[1]), {
    realtimeInput: {
      audio: { data: "pcm-base64", mimeType: "audio/pcm;rate=16000" },
    },
  });
});

test("routes interim and final transcription separately", async () => {
  const socket = new FakeSocket();
  const client = await connect(socket);
  const interim = [];
  const final = [];
  client.onInterimText = (text) => interim.push(text);
  client.onFinalText = (text) => final.push(text);

  socket.message({ serverContent: { interimInputTranscription: { text: "hel" } } });
  socket.message({ serverContent: { inputTranscription: { text: "hello" } } });

  assert.deepEqual(interim, ["hel"]);
  assert.deepEqual(final, ["hello"]);
  assert.equal(client.getFinalText(), "hello");
});

test("endStream sends audioStreamEnd once and resolves at turnComplete", async () => {
  const socket = new FakeSocket();
  const client = await connect(socket);
  socket.message({ serverContent: { inputTranscription: { text: "final text" } } });

  const ending = client.endStream();
  assert.deepEqual(JSON.parse(socket.sent[1]), { realtimeInput: { audioStreamEnd: true } });
  assert.equal(client.endStream(), ending);
  socket.message({ serverContent: { turnComplete: true } });

  assert.equal(await ending, "final text");
  assert.equal(socket.sent.filter((payload) => JSON.parse(payload).realtimeInput?.audioStreamEnd).length, 1);
});

test("endStream stays idempotent after turnComplete", async () => {
  const socket = new FakeSocket();
  const client = await connect(socket);
  socket.message({ serverContent: { inputTranscription: { text: "final text" } } });

  const ending = client.endStream();
  socket.message({ serverContent: { turnComplete: true } });
  await ending;

  assert.equal(await client.endStream(), "final text");
  assert.equal(socket.sent.filter((payload) => JSON.parse(payload).realtimeInput?.audioStreamEnd).length, 1);
});

test("endStream stays idempotent after its timeout", async () => {
  const socket = new FakeSocket();
  const client = await connect(socket);
  socket.message({ serverContent: { inputTranscription: { text: "timed final" } } });
  const setTimeoutOriginal = global.setTimeout;
  global.setTimeout = (callback, delay, ...args) => {
    if (delay === 15_000) {
      queueMicrotask(() => callback(...args));
      return 0;
    }
    return setTimeoutOriginal(callback, delay, ...args);
  };

  try {
    assert.equal(await client.endStream(), "timed final");
    assert.equal(await client.endStream(), "timed final");
    assert.equal(socket.sent.filter((payload) => JSON.parse(payload).realtimeInput?.audioStreamEnd).length, 1);
  } finally {
    global.setTimeout = setTimeoutOriginal;
  }
});

test("reports socket errors and permits repeated disconnect", async () => {
  const socket = new FakeSocket();
  const client = await connect(socket);
  let received;
  client.onError = (error) => { received = error; };

  socket.error(new Error("network failed"));
  assert.match(received.message, /network failed/);
  client.disconnect();
  client.disconnect();
  assert.equal(socket.closed, true);
  assert.equal(client.isConnected(), false);
});

test("stale socket events cannot change readiness after reconnect", async () => {
  const oldSocket = new FakeSocket();
  const currentSocket = new FakeSocket();
  const sockets = [oldSocket, currentSocket];
  const client = new GeminiTranscribeLiveClient({
    apiKey: "test",
    WebSocketImpl: () => sockets.shift(),
  });

  await connect(oldSocket, client);
  client.disconnect();

  const reconnecting = client.connect();
  currentSocket.open();
  oldSocket.message({ setupComplete: {} });
  oldSocket.error(new Error("stale error"));
  oldSocket.close();

  assert.equal(await settles(reconnecting), false);
  assert.equal(client.isConnected(), false);
  currentSocket.message({ setupComplete: {} });
  await reconnecting;

  oldSocket.close();
  assert.equal(client.isConnected(), true);
});

test("disconnect cancels setup wait and permits an immediate replacement connection", async () => {
  const firstSocket = new FakeSocket();
  const replacementSocket = new FakeSocket();
  const sockets = [firstSocket, replacementSocket];
  const client = new GeminiTranscribeLiveClient({
    apiKey: "test",
    WebSocketImpl: () => sockets.shift(),
  });
  const setTimeoutOriginal = global.setTimeout;
  global.setTimeout = (callback, delay, ...args) => {
    if (delay === 10_000) return { callback, args };
    return setTimeoutOriginal(callback, delay, ...args);
  };

  try {
    const connecting = client.connect();
    connecting.catch(() => {});
    firstSocket.open();
    client.disconnect();

    assert.equal(await settles(connecting), true);
    await assert.rejects(connecting, /disconnected/i);

    const reconnecting = client.connect();
    replacementSocket.open();
    replacementSocket.message({ setupComplete: {} });
    await reconnecting;
    assert.equal(client.isConnected(), true);
  } finally {
    global.setTimeout = setTimeoutOriginal;
  }
});

test("Live connection test uses handshake rather than REST transcription", async () => {
  const handlers = new Map();
  let restTranscribeCalls = 0;
  const liveClients = [];
  const originalLoad = Module._load;

  class FakeLiveClient {
    constructor(options) {
      this.options = options;
      liveClients.push(this);
    }

    async connect() {}
    disconnect() { this.disconnected = true; }
  }

  Module._load = function loadForIpcTest(request, parent, isMain) {
    if (request === "electron") {
      return { ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) } };
    }
    if (request === "../cloudAsrClient") {
      return { transcribe: async () => { restTranscribeCalls += 1; return ""; } };
    }
    if (request === "../geminiTranscribeLiveClient") return FakeLiveClient;
    return originalLoad.call(this, request, parent, isMain);
  };

  const ipcPath = require.resolve("../src/helpers/ipc/transcription");
  delete require.cache[ipcPath];
  try {
    const register = require(ipcPath);
    register({
      databaseManager: {
        getSetting: (key) => key === "cloud_asr_settings"
          ? JSON.stringify({ provider: "gemini_transcribe", gemini_mode: "live", api_key: "stored-key" })
          : null,
      },
      logger: { error() {} },
    });

    const result = await handlers.get("test-cloud-asr-connection")({}, {
      provider: "gemini_transcribe",
      gemini_mode: "live",
      api_key: "renderer-must-not-control-this",
    });

    assert.deepEqual(result, { success: true });
    assert.equal(restTranscribeCalls, 0);
    assert.equal(liveClients.length, 1);
    assert.equal(liveClients[0].options.apiKey, "stored-key");
    assert.equal(liveClients[0].disconnected, true);
  } finally {
    Module._load = originalLoad;
    delete require.cache[ipcPath];
  }
});

test("preload Live listeners return matching cleanup functions", () => {
  const listeners = new Map();
  const exposedApis = new Map();
  const originalLoad = Module._load;
  Module._load = function loadPreloadForTest(request, parent, isMain) {
    if (request === "electron") {
      return {
        contextBridge: { exposeInMainWorld: (name, api) => exposedApis.set(name, api) },
        ipcRenderer: {
          invoke() {},
          on: (channel, handler) => listeners.set(channel, handler),
          removeListener: (channel, handler) => {
            assert.equal(listeners.get(channel), handler);
            listeners.delete(channel);
          },
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const preloadPath = require.resolve("../preload");
  delete require.cache[preloadPath];
  try {
    require(preloadPath);
    const exposedApi = exposedApis.get("electronAPI");
    assert.equal(typeof exposedApi.cloudLiveStart, "function");
    assert.equal(typeof exposedApi.cloudLiveFeed, "function");
    assert.equal(typeof exposedApi.cloudLiveEnd, "function");
    assert.equal(typeof exposedApi.cloudLiveAbort, "function");

    const received = [];
    const unsubscribe = exposedApi.onCloudLiveInterim((text) => received.push(text));
    listeners.get("cloud-live-interim")({}, "partial");
    assert.deepEqual(received, ["partial"]);
    unsubscribe();
    assert.equal(listeners.has("cloud-live-interim"), false);
  } finally {
    Module._load = originalLoad;
    delete require.cache[preloadPath];
  }
});
