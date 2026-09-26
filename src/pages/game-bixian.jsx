import React, { useEffect, useRef, useState } from "react";
import {
  PAPER, createRng, createDriftState, summon, ask, sendOff, resumeForSendoff, step, slippedLoose,
} from "../lib/bixian-drift.js";
import { markLingering, clearLingering, hasLingering } from "../lib/bixian-linger.js";
import { CELLS, VERIFY_CELL } from "../lib/bixian-board.js";
import { createTrail, pruneTrail, trailSample, trailBuckets } from "../lib/bixian-trail.js";
import {
  createResponder, adjudicate, nextMood, MOOD_PARAMS, runSpiritCall,
} from "../lib/bixian-responder.js";
import {
  DISTURB_TIERS, VIBES, BURST, CANDLE_DIP, tierForMood, rhythmForPhase,
  createDisturbState, stepAmbient, settlePlan,
} from "../lib/bixian-disturb.js";

// 仪式口诀（调研报告 §2.3：人民网版本的语序）
const CHANT_SUMMON = "笔仙笔仙，我是你的今生，你是我的前世，若要与我续缘，请在纸上画圈。";
const CHANT_SENDOFF = "笔仙笔仙，今日问事已毕，天光将晓，请你回去吧。";
const MAX_QUESTIONS = 5; // 一局至多五问（验笔是仪式脚本，不占问数；迷走亦不占）
const PERSONALITY = "steady"; // 请仙时的静息基准性格；越界/禁忌经 MOOD_PARAMS 转躁、升档
const STILL_PHASES = new Set(["idle", "returned", "settled"]); // 笔迹沥干后可停帧的相位
const CN_NUM = ["一", "二", "三", "四", "五"];
const SPIRIT_DRY = new Set(["quota", "exhausted"]); // 仙力竭尽的两种来路：429 实测 / 配额预判
const SLIP_HINT = "离笔过远，笔已脱手——指尖按在笔近处（随笔而行）续扶"; // 严格式脱手提示（问询/纸面下共用）
// 仙未离去警示：记号在任何「非回位离场」时都会打——请仙途中、验笔途中亦算，
// 故措辞不可称「问毕」（那只是其中一种来路），只陈「未及送仙、笔未回位」这一个事实
const LINGER_TITLE = "仙未离去";
const LINGER_NOTE = "前番请仙，未及送仙、笔未回位，仙仍在此。礼当补行送仙，送毕方安。";
// 局终科普（调研报告 §3 观念运动效应；措辞分寸依 §5.2：陈其理、不吓人）
const SCIENCE_TITLE = "笔为何自走 · 观念运动之说";
const SCIENCE_PARAS = [
  "请仙之戏里「笔自己动」的现象，百余年来早有探究，今称「观念运动效应」：心中存着所盼之答，手上便生出极微而不自知的用力，笔随笔主的心念偏移。一八五二年英国学者卡彭特为此定名，其后法拉第等人反复检验——诚实的人，也会无意识地做出与自己期望一致的动作。",
  "传统玩法要求悬腕无撑、纸面光滑、笔尖一点着纸：此般条件下执笔诸力彼此相推，画圈几乎必然。所见答案，多半出自问者自己的期许与暗知；亦有实验见问者以此道答出了自己未曾意识到的知识。仙灵之说，姑妄听之。",
];
const VIBE_OK = typeof navigator !== "undefined" && "vibrate" in navigator; // API 在场才试震；脉冲环始终伴发（桌面 Chrome 空有 API 不震，也走补偿）
const STAGE_BADGE = {
  entrance: "归寂", summoning: "请仙", verify: "验笔", inquiry: "问询", divining: "问询", sendoff: "送仙", returned: "回位",
};
// 笔行段（drift）的徽章随仪式语义走：验笔之问用「验笔」，正式问询用「问询」（词条不另造词）
const driftBadge = (kind) => (kind === "verify" ? "验笔" : "问询");

export default function BixianGame({ apiKey, onKey, quota, onQuota, onExit }) {
  // apiKey / onKey / quota / onQuota 沿用全站注入缝：自带 key 优先用自己的灵力，
  // 否则走站方共享配额；仙力竭尽或调用失败时回答器自退天意（见 bixian-responder）。
  const engineRef = useRef(null);
  const trailRef = useRef(createTrail());
  const holdingRef = useRef(false);
  const inkVisibleRef = useRef(false); // 上一帧屏上是否还有墨：沥干后的首个空帧也要重绘一次，清掉最后一段笔迹
  const flashTimerRef = useRef(null);
  const lastQuestionRef = useRef(""); // 当前 drift 段的用户问题
  const driftKindRef = useRef(null); // verify | ask | send：当前 drift 段的仪式语义
  const responderRef = useRef(createResponder()); // 同局同问缓存（随局重建）
  const verdictRef = useRef(null); // 当前问的裁决：settled/strayed 回调按它落文案与问事录
  const paramsRef = useRef(MOOD_PARAMS.calm); // 帧循环实际使用的漂移参数包（随笔势换）
  const paperWrapRef = useRef(null); // 纸面块：摇晃/爆发/骤暗类全在这上面 imperative 挂（className prop 保持静态，不与 React 冲突）
  const pointerRef = useRef(null); // 指尖纸面坐标：严格式脱手判定与共振输入共用
  const disturbRef = useRef(createDisturbState()); // 环境震动调度器（随局重建）
  const pulseSeqRef = useRef(0); // 脉冲环自增 id（React key）
  const timersRef = useRef(new Set()); // 扰动相关延时器集中管理，卸载时统一清
  const [mood, setMood] = useState("calm"); // 笔势：calm|restless|furious，越界转躁、触怒升档、随局持续（亦驱动常驻摇晃档）
  const moodRef = useRef(mood); moodRef.current = mood;
  const [holdStyle, setHoldStyle] = useState("strict"); // 扶笔式：严格为默认（指尖随笔，离笔即脱）；宽松（按压即扶）为易用/无障碍开关
  const [resonance, setResonance] = useState(false); // 共振放大：严格式下指尖偏离成为笔的扰动力；可选、默认关
  const [vibeOn, setVibeOn] = useState(true); // 震动：仅扶笔时发（手指在笔上才有体感），移动端默认开
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [slipNote, setSlipNote] = useState(false); // 严格式脱手提示（离笔过远）
  const [pulses, setPulses] = useState([]); // 视觉脉冲环：无 Vibration API 环境的震动补偿，{ id, x, y, calm }
  const holdStyleRef = useRef(holdStyle); holdStyleRef.current = holdStyle;
  const resonanceRef = useRef(resonance); resonanceRef.current = resonance;
  const vibeOnRef = useRef(vibeOn); vibeOnRef.current = vibeOn;
  const reducedRef = useRef(reduced); reducedRef.current = reduced;
  const [stage, setStage] = useState("entrance"); // entrance|summoning|verify|drift|divining|inquiry|sendoff|returned
  const stageRef = useRef(stage); // 异步裁决返回时核对局面未变（避免闭包旧 stage）
  stageRef.current = stage;
  const [questions, setQuestions] = useState([]); // 本局问事：{ q, answer, kind: verify|ask|stray, via?, cause? }
  const [input, setInput] = useState("");
  const [flash, setFlash] = useState(null); // 落定/回位反馈条
  const [fateNote, setFateNote] = useState(null); // 上问失准提示：{ q, reason }，可重问
  const [logOpen, setLogOpen] = useState(false); // 问事录折叠面：新答自动展开，随手可收（问询全相位可回看）
  const [lingering, setLingering] = useState(() => hasLingering()); // 仙未离去：挂载时读一次会话记号（前番未回位离场）
  const [, setTick] = useState(0); // 帧驱动重绘

  const engine = engineRef.current;
  const phase = engine ? engine.phase : "idle";
  const askedCount = questions.filter((item) => item.kind === "ask").length;
  // 问事录口径：验笔是仪式脚本不入录；迷走也是一问（只是不占问数）
  const isAskedEntry = (item) => item.kind !== "verify";
  const logEntries = questions.filter(isAskedEntry); // 问事录全量（摘要计数与逐行回看共用，只筛一次）
  const hasInquired = logEntries.length > 0;
  // 问事录在场范围：问询全相位（请示/笔行/待问）皆可展开回看；验笔是礼不入录、送仙一起便收
  const askingPhase = stage === "inquiry" || stage === "divining" || (stage === "drift" && driftKindRef.current === "ask");

  function flashOnce(label) {
    setFlash({ label });
    clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(null), 2800);
  }

  function after(ms, fn) {
    const timer = setTimeout(() => { timersRef.current.delete(timer); fn(); }, ms);
    timersRef.current.add(timer);
    return timer;
  }

  function noteSlip() {
    setSlipNote(true);
    after(3200, () => setSlipNote(false));
  }

  function vibeLive() { // 震动闸门：扶笔中、未关、未降级（帧循环与落定顿共用同一判据）
    return holdingRef.current && vibeOnRef.current && !reducedRef.current;
  }

  // —— 扰动呈现：何时发已由 bixian-disturb 裁定，这里只管「怎么动」——

  function burstSway() { // 落定爆发一档：±10px+0.5°×8 次 0.11s（参数契约在 BURST，CSS 同源标定）
    const el = paperWrapRef.current;
    if (!el) return;
    el.classList.remove("bx-burst");
    void el.offsetWidth; // 强制回流以重启动画：连续两问都要能爆发
    el.classList.add("bx-burst");
    after(BURST.reps * BURST.stepMs + 80, () => el.classList.remove("bx-burst"));
  }

  function candleDip() { // 烛光骤暗：brightness .5 / 550ms（transition 实现，减弱动效下「短暗」仍保留）
    const el = paperWrapRef.current;
    if (!el) return;
    el.classList.add("bx-dip");
    after(CANDLE_DIP.ms, () => el.classList.remove("bx-dip"));
  }

  function spawnPulse(calm = false) { // 视觉脉冲环（减弱动效下不发：无闪）
    if (reducedRef.current) return;
    const pos = engineRef.current?.pos ?? PAPER.center;
    const id = ++pulseSeqRef.current;
    setPulses((list) => [...list, { id, x: pos.x, y: pos.y, calm }]);
    after(800, () => setPulses((list) => list.filter((pulse) => pulse.id !== id)));
  }

  function fireVibe(pattern) { // 震动与脉冲环同发（原型同款）：脉冲按震动节拍逐段绽开——有体感的机器是伴视，
    // 无 Vibration API（iOS Safari）或空有 API 不震（桌面 Chrome）的机器自动成为纯补偿，不漏发
    let at = 0;
    pattern.forEach((ms, i) => { if (i % 2 === 0) after(at, () => spawnPulse()); at += ms; });
    if (VIBE_OK) {
      try { navigator.vibrate(pattern); } catch { /* 权限/环境异常：静默 */ }
    }
  }

  // 帧循环经 ref 调用，避免闭包拿到旧函数（同 handlePhaseRef 之理）
  const fireVibeRef = useRef(() => {});
  fireVibeRef.current = fireVibe;

  // 相位迁移的界面反响（由帧循环回调；经 ref 持有以避免闭包拿到旧 stage）
  const handlePhaseRef = useRef(() => {});
  handlePhaseRef.current = (nextPhase, prevPhase) => {
    if (prevPhase === "summoning" && nextPhase === "ready") {
      setStage("verify");
      return;
    }
    if (nextPhase === "settled") {
      const { answer } = engineRef.current;
      const verifying = driftKindRef.current === "verify";
      const fate = !verifying && verdictRef.current?.source === "fate";
      flashOnce(verifying ? `仙至——验笔落『${answer.label}』` : `问毕——落定『${answer.label}』${fate ? " · 天意" : ""}`);
      // 落定扰动：常态爆发+烛光骤暗；减弱动效降级为只骤暗。落定顿仅扶笔时给（spec：震动只在扶笔时发）
      const plan = settlePlan({ reduced: reducedRef.current });
      if (plan.burst) burstSway();
      if (plan.dip) candleDip();
      if (vibeLive()) fireVibe(VIBES.settle.pattern);
      setQuestions((list) => [
        ...list,
        verifying
          ? { q: "你是笔仙吗？", answer: answer.label, kind: "verify" }
          : { q: lastQuestionRef.current, answer: answer.label, kind: "ask", via: verdictRef.current?.source ?? "spirit" },
      ]);
      if (!verifying) setLogOpen(true); // 新答入录即展开问事录（验笔是礼，不动问事录）
      if (fate) setFateNote({ q: lastQuestionRef.current, reason: verdictRef.current.reason ?? "call" });
      setStage("inquiry");
      return;
    }
    if (nextPhase === "strayed") {
      const cause = verdictRef.current?.cause === "taboo" ? "taboo" : "overstep";
      flashOnce(cause === "taboo" ? "触怒笔仙——扰动骤升，笔怒而迷走" : "此问越界——笔势转躁，笔自迷走");
      spawnPulse(); // 迷走一圈脉冲（纯视觉，减弱动效下不发）
      setQuestions((list) => [...list, { q: lastQuestionRef.current, answer: "迷走", kind: "stray", cause }]);
      setLogOpen(true); // 迷走也是一答，入录即展开
      setStage("inquiry");
      return;
    }
    if (nextPhase === "returned") {
      flashOnce("笔回位，仙已送走");
      spawnPulse(true); // 回位一环静环收束
      setQuestions([]); // 送仙即焚：回位完成即清问事录，不留一痕（重开新局自然空白）
      clearLingering(); // 仙已离去：会话级「仙未离去」记号即消
      setLingering(false);
      setStage("returned");
    }
  };

  // 帧循环：推进引擎、采样笔迹、按需重绘（静置且墨干后停帧，交互立即恢复）
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;
      const current = engineRef.current;
      if (current) {
        // 严格扶笔：指尖离笔逾界即脱手（笔在动，判定须逐帧做）；宽松式不判
        if (holdingRef.current && holdStyleRef.current === "strict"
          && slippedLoose(current.pos, pointerRef.current, paramsRef.current.strictRadius)) {
          releaseHold(true);
        }
        // 共振放大仅严格式且开启时接通：指尖偏离成为笔的扰动力（引擎侧按 coupling 施力）
        const coupled = holdStyleRef.current === "strict" && resonanceRef.current ? pointerRef.current : null;
        const prevPhase = current.phase;
        step(current, dt, paramsRef.current, { holding: holdingRef.current, mode: holdStyleRef.current, pointer: coupled });
        if (current.phase !== prevPhase) handlePhaseRef.current(current.phase, prevPhase);
        // 着墨以扶笔为准：扶笔（笔尖受压于纸）才留痕；脱手停驻只剩微颤，不添新墨
        if (holdingRef.current && current.phase !== "idle" && current.phase !== "returned") {
          trailSample(trailRef.current, now / 1000, current.pos.x, current.pos.y);
        }
        // 环境震动（常息/间歇三连）：仅扶笔时、未关未降级才发；脱手即止、积压不补发
        const beat = stepAmbient(disturbRef.current, now / 1000, {
          rhythm: rhythmForPhase(current.phase),
          active: vibeLive(),
        });
        if (beat) fireVibeRef.current(beat.pattern);
      }
      pruneTrail(trailRef.current, now / 1000);
      const moving = current && !STILL_PHASES.has(current.phase)
        && (current.phase === "summoning" || holdingRef.current || Math.hypot(current.vel.x, current.vel.y) > 0.05);
      const hasInk = trailRef.current.samples.length > 0;
      if (moving || hasInk || inkVisibleRef.current) setTick((n) => n + 1);
      inkVisibleRef.current = hasInk;
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(flashTimerRef.current);
      for (const timer of timersRef.current) clearTimeout(timer);
      timersRef.current.clear();
    };
  }, []);

  // —— 仪式指令 ——

  // 建新引擎并清尽上一局的局内态（请仙与补行送仙共用；问事录只存内存，随建随空）
  function prepareEngine() {
    clearTimeout(flashTimerRef.current);
    const seed = ((Date.now() & 0xffff) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    const next = createDriftState({ rng: createRng(seed), personality: PERSONALITY });
    engineRef.current = next;
    trailRef.current = createTrail();
    driftKindRef.current = null;
    lastQuestionRef.current = "";
    responderRef.current = createResponder(); // 同问缓存随局重建：上一局的裁决不带入新局
    verdictRef.current = null;
    disturbRef.current = createDisturbState(); // 环境震动随局重新布防
    setMood("calm"); // 笔势归静
    moodRef.current = "calm";
    paramsRef.current = MOOD_PARAMS.calm;
    setQuestions([]);
    setInput("");
    setFlash(null);
    setFateNote(null);
    setSlipNote(false);
    setPulses([]);
    setLogOpen(false);
    return next;
  }

  function beginSummon() {
    const next = prepareEngine();
    summon(next);
    setStage("summoning");
  }

  // 补行送仙（仙未离去）：前番未回位，重进后不念请仙口诀，笔自纸面一处径直送回纸心，补完未竟之礼。
  // 已知取舍：记号只存「仙还在」这一个事实（spec 禁落盘），笔位、问事录、笔势、同问缓存一概无从复原，
  // 故此补礼必从一副新引擎起步——笔势归静、缓存重置。仪式礼数补全了，但严格说已非原局，仅供补礼、勿作续局。
  function resumeSendOff() {
    const next = prepareEngine();
    resumeForSendoff(next);
    driftKindRef.current = "send";
    setStage("sendoff");
  }

  function castVerify() {
    const current = engineRef.current;
    if (!current || stage !== "verify" || current.phase !== "ready") return;
    driftKindRef.current = "verify";
    ask(current, VERIFY_CELL); // 仪式脚本：固定落『勾』，不走回答器、不占问数
    setStage("drift");
  }

  // 发问 = 一次裁决（问审 + 落定，双 choice 一次调用）；retryText 供「重问上问」复用
  async function castQuestion(event, retryText) {
    event?.preventDefault();
    const current = engineRef.current;
    const text = (retryText ?? input).trim();
    if (!current || stageRef.current !== "inquiry" || !text || askedCount >= MAX_QUESTIONS) return;
    if (current.phase !== "settled" && current.phase !== "strayed") return;
    driftKindRef.current = "ask";
    lastQuestionRef.current = text;
    setInput("");
    setFateNote(null);
    setStage("divining");
    // 未带自有 key 且全站配额已知为 0：不必发这一次注定 429 的调用，直接退天意
    const spiritExhausted = !apiKey && quota?.available === true && quota.remaining < 1;
    const verdict = await adjudicate(responderRef.current, text, {
      call: (payload) => runSpiritCall(payload, { apiKey, onQuota }),
      rng: current.rng,
      exhausted: spiritExhausted,
    });
    if (engineRef.current !== current || stageRef.current !== "divining") return; // 等待期间已另起仪式/离场：此问作废
    verdictRef.current = verdict;
    const next = nextMood(moodRef.current, verdict); // 越界转躁 / 触怒升档，随局持续（怒级常驻摇晃升至明晃即止）
    moodRef.current = next;
    setMood(next);
    paramsRef.current = MOOD_PARAMS[next];
    ask(current, verdict.kind === "answer" ? verdict.cell : null); // 越界/禁忌 → 无目标迷走
    setStage("drift");
  }

  function castSendOff() {
    const current = engineRef.current;
    if (!current || stage !== "inquiry" || !hasInquired || (current.phase !== "settled" && current.phase !== "strayed")) return;
    driftKindRef.current = "send";
    sendOff(current);
    setStage("sendoff");
  }

  // —— 扶笔（严格式默认：指尖按在笔旁、随笔而行，离笔逾 15u 即脱手；宽松式为易用开关：按压即扶。
  //     两式笔位都从不跟随指针——扶笔只是闸门，脱手即停驻 + 计时冻结）———

  function paperPoint(event) { // 指尖的纸面坐标（viewBox 与 PAPER 同为 100×160，等比映射）
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * PAPER.w,
      y: ((event.clientY - rect.top) / rect.height) * PAPER.h,
    };
  }

  function grabHold(event) {
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 非活动指针（合成事件等）：捕获失败不影响扶笔 */ }
    const point = paperPoint(event);
    pointerRef.current = point;
    const current = engineRef.current;
    if (holdStyleRef.current === "strict" && current
      && slippedLoose(current.pos, point, paramsRef.current.strictRadius)) {
      noteSlip(); // 按点离笔太远：不接入扶笔，提示按近处
      return;
    }
    holdingRef.current = true;
    setTick((n) => n + 1);
  }

  function moveHold(event) {
    if (!holdingRef.current) return;
    pointerRef.current = paperPoint(event);
  }

  function releaseHold(slipped = false) {
    holdingRef.current = false;
    pointerRef.current = null;
    if (slipped) noteSlip();
    setTick((n) => n + 1);
  }

  // —— 常驻摇晃：档随笔势（静/躁微晃、怒明晃），仙在则常驻、回位归寂即止；
  //     减弱动效下不挂任何摇晃类（全档降级：无晃无闪）。类经 ref imperative 挂卸，className prop 保持静态 ——
  const spiritAlive = !!engine && phase !== "returned";
  useEffect(() => {
    const el = paperWrapRef.current;
    if (!el) return;
    for (const tier of DISTURB_TIERS) el.classList.remove(`bx-sway-${tier.id}`);
    if (reduced || !spiritAlive) return;
    el.classList.add(`bx-sway-${DISTURB_TIERS[tierForMood(moodRef.current)].id}`);
  }, [mood, reduced, spiritAlive]);

  // 系统层实时跟随 prefers-reduced-motion（标定/无障碍：切换即时生效）
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // —— 仙未离去：未回位而离场（回大厅/刷新/关页）留会话级记号，重进警示；回位即消（见 handlePhase）——
  useEffect(() => {
    const spiritPresent = () => {
      const current = engineRef.current;
      return !!current && current.phase !== "returned";
    };
    const mark = () => { if (spiritPresent()) markLingering(); };
    const onPageHide = () => mark(); // 刷新/关页不一定走 React 卸载，pagehide 兜底
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      mark(); // 回大厅等站内离场：卸载时留记号
    };
  }, []);

  // —— 纸面渲染 ——

  const pos = engine ? engine.pos : PAPER.center;
  const buckets = trailBuckets(trailRef.current, performance.now() / 1000);
  const summonProgress = phase === "summoning" ? Math.min(1, engine.t / paramsRef.current.summonTime) : 0;
  const chantShown = CHANT_SUMMON.slice(0, Math.ceil((stage === "summoning" ? summonProgress : 1) * CHANT_SUMMON.length));
  const litCell = phase === "settled" && engine.answer?.type === "cell" ? engine.answer.key : null;
  const lit = litCell ? CELLS.find((cell) => cell.key === litCell) : null;
  const holdable = ["ready", "asking", "strayed", "sending"].includes(phase);
  const drifting = stage === "drift";
  const holding = holdingRef.current;

  return (
    <main className="bx-page wrap">
      <div className="bx-scene">
        <div className="bx-head">
          <button className="bx-back" onClick={onExit} aria-label="回大厅">×</button>
          <div><strong>笔仙</strong><span>ROOM 02 · 游戏室</span></div>
          <b className="bx-badge">{stage === "drift" ? driftBadge(driftKindRef.current) : STAGE_BADGE[stage]}</b>
        </div>
        <div className="bx-body">
          <div className="bx-paper-wrap" ref={paperWrapRef}>
            <svg className="bx-paper" viewBox="0 0 100 160" role="img" aria-label="笔仙纸面">
              <defs>
                {/* 渐变必须 userSpaceOnUse：竖直窄件的 objectBoundingBox 在零宽包围盒下不渲染（原型踩坑） */}
                <linearGradient id="bxPenBody" gradientUnits="userSpaceOnUse" x1="-1.8" y1="0" x2="1.8" y2="0">
                  <stop offset="0" stopColor="#241a10" />
                  <stop offset="0.42" stopColor="#8a6b3f" />
                  <stop offset="0.55" stopColor="#c9a266" />
                  <stop offset="1" stopColor="#2b2013" />
                </linearGradient>
              </defs>
              {CELLS.map((cell) => (
                <text key={cell.key} x={cell.x} y={cell.y} className={`bx-cell${litCell === cell.key ? " lit" : ""}`}>{cell.key}</text>
              ))}
              {lit && <circle cx={lit.x} cy={lit.y} r="7" className="bx-settle-ring" />}
              {buckets.map((bucket, index) => (
                <polyline
                  key={index} className="bx-ink"
                  points={bucket.points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")}
                  strokeWidth={bucket.width} strokeOpacity={bucket.opacity.toFixed(3)}
                />
              ))}
              <g transform={`translate(${pos.x.toFixed(3)} ${pos.y.toFixed(3)})`} className={`bx-pen${phase === "idle" ? " resting" : ""}`}>
                <ellipse className="bx-pen-shadow" cx="0" cy="0.9" rx="4.4" ry="1.4" />
                <g transform="rotate(-8)">
                  <polygon className="bx-pen-tip" points="0,0 -1.5,-4.4 1.5,-4.4" />
                  <rect className="bx-pen-ferrule" x="-1.9" y="-6" width="3.8" height="1.7" rx="0.5" />
                  <rect className="bx-pen-body" x="-1.8" y="-21" width="3.6" height="15.2" rx="1.4" fill="url(#bxPenBody)" />
                </g>
              </g>
              <rect
                className={`bx-hold${holdable ? "" : " inert"}`} x="0" y="0" width="100" height="160"
                onPointerDown={grabHold} onPointerMove={moveHold}
                onPointerUp={() => releaseHold()} onPointerCancel={() => releaseHold()}
              />
            </svg>
            {pulses.map((pulse) => (
              <span
                key={pulse.id} className={`bx-pulse${pulse.calm ? " calm" : ""}`}
                style={{ left: `${pulse.x}%`, top: `${(pulse.y / 160) * 100}%` }}
              />
            ))}
            {flash && <div className="bx-flash" key={flash.label}>{flash.label}</div>}
          </div>
          <aside className="bx-panel">
            {stage === "entrance" && (
              <div className="bx-card">
                <span className="bx-kicker">入局须知</span>
                <h2>夜静更深，铺纸请仙</h2>
                <p>一局之礼：请仙 → 验笔 → 问询 → 送仙 → 回位。至多五问，问毕必送，送必至回位。</p>
                <p>扶笔之法：指尖按在笔旁、随笔而行，离笔过远即脱手（易用可切宽松式：按住纸面即扶）；笔行于纸，不由人引。</p>
                {lingering ? (
                  // 仙未离去：唯一去路是补行送仙——送仙必须完成（CONTEXT.md 送仙），
                  // 故不设「另起一局」逃生口，免得新局回位反把旧仙的警示抹掉
                  <div className="bx-linger">
                    <strong>{LINGER_TITLE}</strong>
                    <p>{LINGER_NOTE}</p>
                    <button className="bx-primary" onClick={resumeSendOff}>补行送仙 🕯️</button>
                  </div>
                ) : (
                  <button className="bx-primary" onClick={beginSummon}>点烛请仙 🕯️</button>
                )}
                <p className="bx-dim">戏中之事，纯属娱乐。</p>
              </div>
            )}
            {stage === "summoning" && (
              <div className="bx-card">
                <span className="bx-kicker">请仙 · 口诀</span>
                <p className="bx-chant">「{chantShown}」</p>
                <div className="bx-progress"><div style={{ width: `${Math.round(summonProgress * 100)}%` }} /></div>
                <p className="bx-dim">口诀声中，凝神静候——笔杆微颤，仙将至矣。</p>
              </div>
            )}
            {stage === "verify" && (
              <div className="bx-card">
                <span className="bx-kicker">验笔 · 固定一问</span>
                <p className="bx-chant">「你是笔仙吗？」</p>
                <p className="bx-dim">以此一问验笔：笔落『勾』，即仙至。此问为礼，不占问数。</p>
                <button className="bx-primary" onClick={castVerify}>念出此问</button>
              </div>
            )}
            {stage === "divining" && (
              <div className="bx-card">
                <span className="bx-kicker">问询 · 请示</span>
                <p className="bx-chant">「{lastQuestionRef.current}」</p>
                <p className="bx-dim bx-await">仙示未至，笔锋微顿——凝神静候。</p>
              </div>
            )}
            {stage === "drift" && (
              <div className="bx-card">
                <span className="bx-kicker">{driftKindRef.current === "verify" ? "验笔 · 笔行" : "问询 · 笔行"}</span>
                <p className="bx-chant">「{driftKindRef.current === "verify" ? "你是笔仙吗？" : lastQuestionRef.current}」</p>
                <p className="bx-dim">{holding
                  ? "扶笔勿离——笔自运行，蓄势而动，渐近乃止。"
                  : slipNote && holdStyle === "strict"
                    ? `${SLIP_HINT}。`
                    : "笔已停驻——按住纸面，续扶此笔。"}</p>
              </div>
            )}
            {stage === "inquiry" && (
              <div className="bx-card">
                <span className="bx-kicker">问询 · 第 {CN_NUM[Math.min(askedCount, MAX_QUESTIONS - 1)]} 问</span>
                {askedCount >= MAX_QUESTIONS ? (
                  <React.Fragment>
                    <p>五问已满，问事当毕。</p>
                    <button className="bx-primary" onClick={castSendOff}>送仙回位</button>
                  </React.Fragment>
                ) : (
                  <form className="bx-ask" onSubmit={(event) => castQuestion(event)}>
                    <input
                      value={input} onChange={(event) => setInput(event.target.value)} maxLength={40}
                      placeholder="心中所问，落于纸上" aria-label="欲问之事"
                    />
                    <div className="bx-ask-row">
                      <button type="submit" className="bx-primary" disabled={!input.trim()}>落笔发问</button>
                      {hasInquired && <button type="button" className="bx-ghost" onClick={castSendOff}>就此送仙</button>}
                    </div>
                    <small className="bx-dim">尚可问 {CN_NUM[MAX_QUESTIONS - askedCount - 1]} 问 · 纸面自答：勾叉是否、一至十、唐宋元明清、男女</small>
                  </form>
                )}
                {fateNote && askedCount < MAX_QUESTIONS && (
                  <div className="bx-fate-note">
                    <small className="bx-dim">上问灵力不济、笔迹失准——答案乃天意乱书{SPIRIT_DRY.has(fateNote.reason) ? "，今日仙力已尽" : ""}。重问可再请仙示。</small>
                    <div className="bx-ask-row">
                      <button type="button" className="bx-ghost" onClick={() => castQuestion(null, fateNote.q)}>重问上问</button>
                      {SPIRIT_DRY.has(fateNote.reason) && <button type="button" className="bx-ghost" onClick={onKey}>填自己的 key 续灵力</button>}
                    </div>
                  </div>
                )}
              </div>
            )}
            {stage === "sendoff" && (
              <div className="bx-card">
                <span className="bx-kicker">送仙 · 口诀</span>
                <p className="bx-chant">「{CHANT_SENDOFF}」</p>
                <p className="bx-dim">{holding ? "扶笔相送——笔回纸心，停稳即回位。" : slipNote ? `${SLIP_HINT}，随笔回位。` : "按住纸面扶笔，随笔回位。"}</p>
              </div>
            )}
            {stage === "returned" && (
              <div className="bx-card">
                <span className="bx-kicker">回位 · 归寂</span>
                <p className="bx-chant">仙已送回，纸面归寂。</p>
                <p className="bx-dim">笔迹与问事随烟而散，不留于纸。</p>
                <details className="bx-science">
                  <summary>{SCIENCE_TITLE}</summary>
                  {SCIENCE_PARAS.map((para) => <p key={para}>{para}</p>)}
                </details>
                <p className="bx-dim">本游戏纯属娱乐，纸面之事，不问吉凶。</p>
                <div className="bx-ask-row">
                  <button className="bx-primary" onClick={beginSummon}>再请一局</button>
                  <button className="bx-ghost" onClick={onExit}>回大厅</button>
                </div>
              </div>
            )}
            {askingPhase && hasInquired && (
              // 问事录（仅内存态）：问询全相位可展开回看，新答自动展开；送仙一起即收、回位即焚
              <details className="bx-log" open={logOpen} onToggle={(event) => setLogOpen(event.currentTarget.open)}>
                <summary>问事录 · 已问 {logEntries.length} 则</summary>
                {(() => {
                  let askSeq = 0; // 问数只数 ask（迷走不占问数），故编号必在 CN_NUM 界内
                  return logEntries.map((item, index) => (
                    <div key={`${index}-${item.q}`}>
                      <span>{item.kind === "ask" ? `问${CN_NUM[askSeq++]}` : item.cause === "taboo" ? "怒" : "越"}</span><em>{item.q}</em>
                      <b className={item.kind === "stray" || item.via === "fate" ? "bx-off" : ""}>
                        {item.answer}{item.via === "fate" ? "·天意" : ""}
                      </b>
                    </div>
                  ));
                })()}
              </details>
            )}
            <div className="bx-toggles">
              <span className="bx-kicker">扶笔与扰动</span>
              <div className="bx-toggle-row">
                <span>扶笔式</span>
                <div className="bx-seg" role="group" aria-label="扶笔式">
                  <button type="button" className={holdStyle === "strict" ? "on" : ""} onClick={() => setHoldStyle("strict")}>严格</button>
                  <button type="button" className={holdStyle === "loose" ? "on" : ""} onClick={() => setHoldStyle("loose")}>宽松</button>
                </div>
              </div>
              <label className="bx-toggle-row">
                <span>共振放大{holdStyle === "strict" ? "" : "（需严格式）"}</span>
                <input
                  type="checkbox" checked={resonance && holdStyle === "strict"} disabled={holdStyle !== "strict"}
                  onChange={(event) => setResonance(event.target.checked)} aria-label="共振放大"
                />
              </label>
              <label className="bx-toggle-row">
                <span>震动（仅扶笔时{VIBE_OK ? "" : "，此机无体感"}·伴脉冲环）</span>
                <input type="checkbox" checked={vibeOn} onChange={(event) => setVibeOn(event.target.checked)} aria-label="震动" />
              </label>
            </div>
          </aside>
        </div>
        {drifting && !holding && (
          <div className="bx-hint">{slipNote && holdStyle === "strict" ? SLIP_HINT : "笔已停驻 · 按住纸面续扶"}</div>
        )}
      </div>
    </main>
  );
}
