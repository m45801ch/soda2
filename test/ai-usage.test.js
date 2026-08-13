import { strict as assert } from "node:assert";
import test from "node:test";
import { EventEmitter } from "node:events";

// 建立一個假的 databaseManager（用物件模擬，不需真的 better-sqlite3）
function makeFakeDB(initial = {}) {
  const store = { ...initial };
  return {
    settings: store,
    getSetting(key, def) {
      return store[key] !== undefined ? store[key] : def;
    },
    setSetting(key, value) {
      store[key] = value;
    },
  };
}

// 從 database.js 抽出 _todayKey / incrementAiUsage / getAiUsage 的邏輯來測（避免載入 better-sqlite3）
// 實際實作在 DatabaseManager；這裡用相同的演算法驗證行為。
function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function incrementAiUsage(fakeDB, providerId, now = new Date()) {
  const today = todayKey(now);
  const raw = fakeDB.getSetting("ai_daily_usage", {});
  const map = raw && typeof raw === "object" ? raw : {};
  const todayUsage = (map[today] && typeof map[today] === "object") ? map[today] : {};
  const provider = String(providerId || "unknown");
  todayUsage[provider] = (Number(todayUsage[provider]) || 0) + 1;
  map[today] = todayUsage;
  fakeDB.setSetting("ai_daily_usage", map);
}

function getAiUsage(fakeDB, now = new Date()) {
  const today = todayKey(now);
  const map = fakeDB.getSetting("ai_daily_usage", {}) || {};
  const todayUsage = (map[today] && typeof map[today] === "object") ? map[today] : {};
  return { today, usage: todayUsage };
}

test("incrementAiUsage accumulates per provider", () => {
  const db = makeFakeDB();
  incrementAiUsage(db, "openai");
  incrementAiUsage(db, "openai");
  incrementAiUsage(db, "cerebras");
  const { usage } = getAiUsage(db);
  assert.equal(usage.openai, 2);
  assert.equal(usage.cerebras, 1);
});

test("getAiUsage ignores previous days", () => {
  const db = makeFakeDB();
  // 昨天的計數
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  incrementAiUsage(db, "openai", yesterday);
  // 今天的計數
  incrementAiUsage(db, "openai");
  const { usage } = getAiUsage(db);
  assert.equal(usage.openai, 1); // 只算今天
});

test("getAiUsage returns today key", () => {
  const db = makeFakeDB();
  const { today } = getAiUsage(db);
  assert.equal(today, todayKey(new Date()));
});

test("incrementAiUsage handles empty or malformed store", () => {
  const db = makeFakeDB();
  db.settings.ai_daily_usage = "not-an-object";
  incrementAiUsage(db, "groq");
  const { usage } = getAiUsage(db);
  assert.equal(usage.groq, 1);
});
