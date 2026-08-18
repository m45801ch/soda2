import { strict as assert } from "node:assert";
import test from "node:test";

const cnNum = { "零": "0", "一": "1", "二": "2", "三": "3", "四": "4", "五": "5", "六": "6", "七": "7", "八": "8", "九": "9" };

// 類別 3：一點X點Y點Z...（版本號 / 連續小數點）→ 1.X.Y.Z
// 例：一點二點三 → 1.2.3
function convertVersionDot(text) {
  if (!text) return text;
  return text.replace(
    /一點([零一二三四五六七八九])((?:點[零一二三四五六七八九])+)/g,
    (match, first, tail) => {
      const digits = [first];
      const tailRe = /點([零一二三四五六七八九])/g;
      let m;
      while ((m = tailRe.exec(tail)) !== null) {
        digits.push(m[1]);
      }
      return "1." + digits.map((d) => cnNum[d] || d).join(".");
    }
  );
}

test("一點二點三 → 1.2.3", () => {
  assert.equal(convertVersionDot("一點二點三"), "1.2.3");
});

test("版本號為 V 一點二點三 → 版本號為 V 1.2.3", () => {
  assert.equal(convertVersionDot("版本號為 V 一點二點三"), "版本號為 V 1.2.3");
});

test("一點零點八 → 1.0.8", () => {
  assert.equal(convertVersionDot("一點零點八"), "1.0.8");
});

test("一點一 (single) stays unchanged (category 1 handles it)", () => {
  assert.equal(convertVersionDot("一點一"), "一點一");
});
test("ordinary text unchanged", () => {
  assert.equal(convertVersionDot("這是一般的句子"), "這是一般的句子");
});
