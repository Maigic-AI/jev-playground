import test from "node:test";
import assert from "node:assert/strict";
import { markLingering, clearLingering, hasLingering } from "../src/lib/bixian-linger.js";

// 「仙未离去」记号（spec #6）：未回位离场时留下的会话级警示。
// 约束有二：① 只记一个有无记号，值恒为裸 "1"——绝不携问事录任何内容（问事录即焚是设定）；
// ② 只写会话级存储，不碰 localStorage 等持久存储。存储经参数注入，测试塞假存储。

// Map 造的假会话存储（接口与 Storage 一致：getItem/setItem/removeItem）
function fakeStore() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test("记一个记号：标记后可读、清除后归无", () => {
  const store = fakeStore();
  assert.equal(hasLingering(store), false, "初始无记号");
  markLingering(store);
  assert.equal(hasLingering(store), true, "离场未回位 → 有记号");
  clearLingering(store);
  assert.equal(hasLingering(store), false, "回位补礼后记号即消");
});

test("记号只是裸旗标：存储里仅有一个常量字符，不含问事内容", () => {
  const store = fakeStore();
  markLingering(store);
  assert.equal(store.map.size, 1, "只写一个键");
  const [[key, value]] = [...store.map.entries()];
  assert.match(key, /bixian/, "键名归属笔仙（不与别家串味）");
  assert.equal(value, "1", "值恒为 \"1\"：问的问题、落的字一概不落此存储");
});

test("各记号互不干扰：清除只删自己的键", () => {
  const store = fakeStore();
  store.setItem("jev-pop-lab:other:v1", "{}"); // 同命名空间下别家的键（占位，非真实模块的键）
  markLingering(store);
  clearLingering(store);
  assert.equal(store.getItem("jev-pop-lab:other:v1"), "{}", "不动他人之键");
  assert.equal(hasLingering(store), false);
});

test("无会话存储的环境（注入 null）：三函数皆静默降级、不抛错", () => {
  assert.doesNotThrow(() => markLingering(null));
  assert.doesNotThrow(() => clearLingering(null));
  assert.equal(hasLingering(null), false, "拿不到会话存储 → 视为无记号（警示静默降级）");
});

test("脏值不认：只有本模块写入的旗标值才算仙未离去", () => {
  const store = fakeStore();
  store.setItem("jev-pop-lab:bixian-linger:v1", "你|是|否|三"); // 假设有人塞了问事内容进来
  assert.equal(hasLingering(store), false, "非旗标值一律读作无记号");
  markLingering(store);
  assert.equal(hasLingering(store), true);
});
