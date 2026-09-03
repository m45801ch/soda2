const assert = require("node:assert/strict");
const test = require("node:test");

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
