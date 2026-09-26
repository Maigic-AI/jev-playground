// 笔仙漂移引擎 —— 纯逻辑模块（无 DOM、无计时器：时间由 step 的 dt 显式推进，随机全部走注入的 RNG）
// 搬运自原型分支 prototype/bixian-drift 最终版的 BixianDrift 模块（含该分支 af9fab9 起的事件 id 跟踪），
// 数学与手感已数值验证；
// 相对原型的改动只有：ESM 化、RNG 注入（createRng 可种子化）、性格包改英文 id（paramsFor 整体替换）、
// 松手微抖幅度参数化 releaseJitterAmp（原型 0.09u 几乎不可见，正式版加大到 0.2–0.3u）。
//
// 漂移手感五要素（缺一则手感崩，spec 定案全部保留）：
//   低阻尼 damping ｜ 环行吸引子 ringK/ringR0（环心 OU 游走）｜ 双向 OU 噪声 noiseAmp/noiseTau
//   蓄势 warmup + startRamp 慢起速 ｜ 渐近 approach（e=bias² 平滑）+ 收势 finalRadius + stillTime
// 收势段是落定的充要条件：径向弹簧撑不住离心力，去掉末段减速螺旋，笔会永远在命中圈外打转。

export const PAPER = { w: 100, h: 160, center: { x: 50, y: 80 } };

// —— 随机源 ——
// 可种子化 RNG（mulberry32）：createDriftState 注入后，step 内全部随机都走它；测试/UI 各自持有种子即可复现
export function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// —— 工具 ——
const gauss = (rng) => {
  let u = 0;
  let v = 0;
  while (!u) u = rng();
  while (!v) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// 平稳 OU 过程一步（amp = 平稳标准差）
const ouStep = (v, amp, tau, dt, rng) => {
  const decay = Math.exp(-dt / tau);
  const k = amp * Math.sqrt(1 - decay * decay);
  v.x = v.x * decay + k * gauss(rng);
  v.y = v.y * decay + k * gauss(rng);
};

export const DEFAULT_PARAMS = {
  // 漂移手感
  cruiseSpeed: 24, // 切向巡航速度 u/s
  ringR0: 24, // 蓄势期画圈半径
  ringK: 3.0, // 环行吸引子径向弹簧
  ringDamp: 1.6, // 径向阻尼
  damping: 0.15, // 全局速度衰减 /s（光滑纸面的低阻尼）
  noiseAmp: 7, // 双向噪声加速度幅度 u/s²
  noiseTau: 0.7, // 噪声相关时间 s（小=碎）
  wanderAmp: 9, // 环心游走幅度 u
  wanderTau: 5, // 环心游走时间尺度 s
  startRamp: 3, // 起动慢：速度 25%→100% 的秒数
  // 渐近答案曲线
  warmup: 6, // 蓄势时长 s（无目的画圈）
  approach: 8, // 渐近时长 s（逐渐偏向目标）
  finalRadius: 5, // 渐近结束的收圈半径 u
  stillTime: 3, // 收势时长 s（偏向完成后徐徐减速停笔）
  // 落定判定
  settleMode: "dwell", // 'dwell' 停留（正式版）| 'circles' 绕字（备选：对高噪声性格不可靠，不进正式玩法）
  dwellTime: 1.2, // 停留判定秒
  settleRadius: 9, // 命中半径 u（必须大于收圈半径）
  circlesNeeded: 2, // 圈数判定（绕目标整圈数）
  // 扶笔
  strictRadius: 15, // 严格判定：手指离笔超过此距离即脱手 u
  coupling: 0.9, // 共振增益：手指偏移→笔扰动力（u/s² per u）
  releaseJitter: true,
  releaseJitterAmp: 0.25, // 松手微抖幅度 u（原型 0.09 几乎不可见，正式版加大）
  strayTime: 12, // 迷走判定秒
  summonTime: 6, // 请仙口诀时长 s
};

// 漂移性格三档（参数包，仅行为差异、永不向用户点名）；沉稳即基准，其余为覆盖项
export const PERSONALITIES = {
  steady: { name: "沉稳", overrides: {} },
  hasty: {
    name: "急躁",
    overrides: { cruiseSpeed: 34, ringR0: 20, ringK: 4.2, damping: 0.22, noiseAmp: 5, wanderAmp: 6, startRamp: 1.5, warmup: 2.5, approach: 4.5, finalRadius: 4, dwellTime: 0.9 },
  },
  erratic: {
    name: "飘忽",
    overrides: { cruiseSpeed: 19, ringR0: 27, ringK: 2.2, damping: 0.08, noiseAmp: 13, noiseTau: 0.35, wanderAmp: 15, wanderTau: 3, startRamp: 4, warmup: 8, approach: 12, finalRadius: 7, dwellTime: 1.8 },
  },
};

// 整包取某档性格的参数（性格差异的唯一载体：整体替换此包即换手感）
export function paramsFor(personalityId) {
  const pack = PERSONALITIES[personalityId];
  if (!pack) throw new Error(`未知漂移性格：${personalityId}（可选：${Object.keys(PERSONALITIES).join(" / ")}）`);
  return { ...DEFAULT_PARAMS, ...pack.overrides };
}

export function createDriftState({ rng = Math.random, personality = "steady" } = {}) {
  return {
    phase: "idle", // idle|summoning|ready|asking|settled|strayed|sending|returned
    t: 0, holdT: 0, holding: false,
    pos: { ...PAPER.center }, vel: { x: 0, y: 0 },
    wander: { x: 0, y: 0 }, noise: { x: 0, y: 0 },
    bias: 0, target: null, blind: false, stray: false,
    angleAcc: 0, circAng: 0, prevAng: null, prevAngT: null, dwell: 0,
    answer: null, questionCount: 0, personality, rng,
    evSeq: 0,
    events: [],
  };
}
const ev = (s, msg) => { s.events.push({ id: ++s.evSeq, msg }); if (s.events.length > 200) s.events.shift(); };

export function summon(s) {
  if (s.phase !== "idle" && s.phase !== "returned") return false;
  s.phase = "summoning"; s.t = 0; ev(s, "请仙：口诀已念，等笔活过来"); return true;
}

export function ask(s, target, opts = {}) {
  if (!["ready", "settled", "strayed", "asking"].includes(s.phase)) return false;
  s.phase = "asking"; s.t = 0; s.bias = 0; s.dwell = 0; s.angleAcc = 0; s.circAng = 0;
  s.prevAng = null; s.prevAngT = null;
  s.target = target || null; s.blind = !!opts.blind; s.stray = !target; s.answer = null;
  s.questionCount += 1;
  ev(s, target ? (s.blind ? "一问已内定（盲，落定揭晓）" : `一问已内定：『${target.label}』`) : "一问已内定：迷走（超纲）");
  return true;
}

export function sendOff(s) {
  if (["idle", "summoning", "sending", "returned"].includes(s.phase)) return false;
  s.phase = "sending"; s.t = 0; s.bias = 0; s.dwell = 0; s.prevAng = null; s.prevAngT = null;
  s.target = { x: PAPER.center.x, y: PAPER.center.y, key: "_center", label: "纸心" };
  s.blind = false; s.stray = false; s.answer = null;
  ev(s, "送仙：笔向纸心回位"); return true;
}

// input: { holding, mode: 'strict'|'loose', pointer: {x,y}|null }

// 严格扶笔的脱手判定：指尖（纸面坐标）距笔超过 strictRadius 即脱手。恰在半径上不算脱——须「超过」。
// 纯函数供 UI 帧循环调用（引擎内部不跟踪指针位置，只收 holding 闸门）；无指针时不判脱（宽松式路径）。
export function slippedLoose(pos, pointer, radius = DEFAULT_PARAMS.strictRadius) {
  if (!pointer) return false;
  return Math.hypot(pointer.x - pos.x, pointer.y - pos.y) > radius;
}

export function step(s, dt, p, input) {
  dt = Math.min(dt, 0.05);
  s.holding = !!input.holding;

  // 请仙：口诀期间笔杆微微颤动（与扶笔无关）
  if (s.phase === "summoning") {
    s.t += dt; const k = Math.min(1, s.t / p.summonTime);
    s.pos.x += gauss(s.rng) * 0.05 * k * Math.sqrt(dt); s.pos.y += gauss(s.rng) * 0.05 * k * Math.sqrt(dt);
    if (s.t >= p.summonTime) { s.phase = "ready"; s.t = 0; ev(s, "笔活了——扶笔即可发问"); }
    return s;
  }
  // 归寂：不动
  if (s.phase === "idle" || s.phase === "returned") { s.vel.x = s.vel.y = 0; return s; }
  // 落定后：泊在答案上，只余极微颤动（不需扶笔）
  if (s.phase === "settled") {
    const g = Math.min(1, 6 * dt);
    s.pos.x += (s.target.x - s.pos.x) * g + gauss(s.rng) * 0.09 * Math.sqrt(dt);
    s.pos.y += (s.target.y - s.pos.y) * g + gauss(s.rng) * 0.09 * Math.sqrt(dt);
    s.vel.x = s.vel.y = 0; return s;
  }

  // —— 以下为可动阶段：ready / asking / strayed / sending ——
  if (!s.holding) {
    // 脱手：笔停驻（快速衰减 + 松手微抖）；计时与判定全部冻结
    const decay = Math.exp(-6 * dt);
    s.vel.x *= decay; s.vel.y *= decay;
    s.pos.x += s.vel.x * dt; s.pos.y += s.vel.y * dt;
    if (p.releaseJitter) { s.pos.x += gauss(s.rng) * p.releaseJitterAmp * Math.sqrt(dt); s.pos.y += gauss(s.rng) * p.releaseJitterAmp * Math.sqrt(dt); }
    return s;
  }
  s.holdT += dt;

  // 环心游走（模拟「两人互相用力」的慢变合力）
  ouStep(s.wander, p.wanderAmp, p.wanderTau, dt, s.rng);
  let c = { x: PAPER.center.x + s.wander.x, y: PAPER.center.y + s.wander.y };
  let R = p.ringR0;
  let speedScale = (s.phase === "ready" || s.phase === "strayed") ? 0.85 : 0.3 + 0.7 * clamp(s.t / p.startRamp, 0, 1);

  if (s.phase === "asking" || s.phase === "sending") {
    s.t += dt;
    if (s.phase === "asking" && s.stray) {
      s.bias = 0;
      if (s.t >= p.strayTime) { s.phase = "strayed"; s.answer = { type: "stray", label: "迷走" }; ev(s, "笔不肯落定——此问迷走"); return s; }
    } else {
      const warm = s.phase === "sending" ? 0.8 : p.warmup;
      const appr = s.phase === "sending" ? 5.5 : p.approach;
      s.bias = clamp((s.t - warm) / appr, 0, 1);
      const e = s.bias * s.bias * (3 - 2 * s.bias); // 先缓后急地偏向目标
      // 收势：偏向完成后徐徐减速、收圈到字心（否则弹簧撑不住离心力，永远在命中圈外打转）
      let tail = 1;
      if (s.bias >= 1) tail = Math.max(0, 1 - (s.t - warm - appr) / (s.phase === "sending" ? 2.5 : p.stillTime));
      // 圈数判定：保持最低巡航，让笔绕着字画圈凑满 N 周（停稳了角度就不再积累）
      if (p.settleMode === "circles" && s.phase === "asking") tail = Math.max(tail, 0.3);
      if (s.phase === "sending") speedScale *= 1 - 0.92 * e;
      else speedScale *= (1 - 0.45 * e) * (0.08 + 0.92 * tail);
      c = { x: lerp(c.x, s.target.x, e), y: lerp(c.y, s.target.y, e) };
      const Rf = s.phase === "sending" ? 0.5 : p.finalRadius;
      R = lerp(lerp(p.ringR0, Rf, e), 0.5, 1 - tail);
    }
  }

  // 力：径向弹簧（环行吸引子）＋ 切向驱动（画圈马达）＋ 双向噪声 ＋ 软边界
  const rx = s.pos.x - c.x, ry = s.pos.y - c.y;
  const d = Math.hypot(rx, ry) || 1e-4;
  const ux = rx / d, uy = ry / d, tx = -uy, ty = ux;
  const vr = s.vel.x * ux + s.vel.y * uy;
  const vt = s.vel.x * tx + s.vel.y * ty;
  const dir = vt >= 0 ? 1 : -1;
  let ringK = p.ringK, ringDamp = p.ringDamp, drive = 2.2;
  if (s.phase === "sending" && s.bias >= 1) { ringK = 9; ringDamp = 3; drive = 0.8; } // 回位末段：强收心、停笔
  const aRad = -ringK * (d - R) - ringDamp * vr;
  const aTan = (p.cruiseSpeed * speedScale * dir - vt) * drive;
  ouStep(s.noise, p.noiseAmp, p.noiseTau, dt, s.rng);
  let ax = ux * aRad + tx * aTan + s.noise.x;
  let ay = uy * aRad + ty * aTan + s.noise.y;

  // 共振放大：严格扶笔下，手指追随的偏移成为扰动力（小输入大输出的观念运动结构）
  if (input.mode === "strict" && input.pointer && p.coupling > 0) {
    ax += p.coupling * clamp(input.pointer.x - s.pos.x, -12, 12);
    ay += p.coupling * clamp(input.pointer.y - s.pos.y, -12, 12);
  }
  // 软边界：不出纸
  if (s.pos.x < 6) ax += (6 - s.pos.x) * 8; if (s.pos.x > PAPER.w - 6) ax -= (s.pos.x - (PAPER.w - 6)) * 8;
  if (s.pos.y < 8) ay += (8 - s.pos.y) * 8; if (s.pos.y > PAPER.h - 8) ay -= (s.pos.y - (PAPER.h - 8)) * 8;

  const dampF = Math.exp(-p.damping * dt);
  s.vel.x = (s.vel.x + ax * dt) * dampF; s.vel.y = (s.vel.y + ay * dt) * dampF;
  s.pos.x += s.vel.x * dt; s.pos.y += s.vel.y * dt;

  // 圈数统计：绕当前环心的累计角（含渐近过程＝「划着圈走」）＋ 绕目标的命中圈
  const ang = Math.atan2(ry, rx);
  if (s.prevAng !== null) { let da = ang - s.prevAng; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; s.angleAcc += da; }
  s.prevAng = ang;
  if (s.phase === "asking" && s.target && !s.stray) {
    const dT = dist(s.pos, s.target);
    const angT = Math.atan2(s.pos.y - s.target.y, s.pos.x - s.target.x);
    if (s.prevAngT !== null) { let da = angT - s.prevAngT; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; if (dT < p.settleRadius * 1.6) s.circAng += da; } // 进 1.6×命中圈即累计绕字圈数（渐近螺旋的绕行也计入），不清零
    s.prevAngT = angT;
    // 落定判定（两种模式，均在渐近完成后才开始）
    if (s.bias >= 1 && dT < p.settleRadius && (p.settleMode === "dwell"
      ? (s.dwell += dt) >= p.dwellTime
      : Math.abs(s.circAng) >= 2 * Math.PI * p.circlesNeeded)) {
      s.phase = "settled"; s.answer = { type: "cell", key: s.target.key, label: s.target.label };
      ev(s, `落定：『${s.answer.label}』${s.blind ? "（盲问揭晓）" : ""}`);
    } else if (p.settleMode === "dwell" && dT >= p.settleRadius) {
      s.dwell = Math.max(0, s.dwell - dt * 0.6); // 离圈则驻留缓退
    }
  }
  // 回位判定
  if (s.phase === "sending" && s.bias >= 1 && dist(s.pos, s.target) < 3.5 && Math.hypot(s.vel.x, s.vel.y) < 3) {
    s.phase = "returned"; ev(s, "笔回位，仙已送走");
  }
  return s;
}
