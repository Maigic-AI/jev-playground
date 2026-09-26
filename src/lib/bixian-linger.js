// 笔仙「仙未离去」记号 —— 会话级警示的小缝（spec #6）
// 未回位而离场（回大厅 / 刷新 / 关页）时只记一个有无记号：重进页面据此警示、可从送仙补起。
// 两条铁律：① 值恒为裸旗标 "1"，绝不携问事录内容（问事录即焚是设定，离场警示只是「仙还在」这一个事实）；
// ② 只写会话级 sessionStorage，不碰 localStorage 等持久存储——会话一了，警示自消。
// 存储经参数注入（默认取全局 sessionStorage，环境没有则静默降级为「无记号」），测试可塞假存储。

const LINGER_KEY = "jev-pop-lab:bixian-linger:v1";
const LINGER_TOKEN = "1";

function sessionStore() {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null; // 隐私模式等场景拿不到会话存储：警示静默降级
  }
}

// 未回位离场：留记号（幂等，重复标记无副作用）
export function markLingering(store = sessionStore()) {
  try { store?.setItem(LINGER_KEY, LINGER_TOKEN); } catch { /* 写不进就算了 */ }
}

// 回位归寂：记号即消
export function clearLingering(store = sessionStore()) {
  try { store?.removeItem(LINGER_KEY); } catch { /* 同上 */ }
}

// 重进页面：读记号（只认本模块写入的旗标值，脏值一律读作无）
export function hasLingering(store = sessionStore()) {
  try { return store?.getItem(LINGER_KEY) === LINGER_TOKEN; } catch { return false; }
}
