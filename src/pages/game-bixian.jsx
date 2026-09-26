import React, { useEffect, useRef, useState } from "react";
import {
  PAPER, createRng, createDriftState, summon, ask, sendOff, step,
} from "../lib/bixian-drift.js";
import { CELLS, VERIFY_CELL } from "../lib/bixian-board.js";
import { createTrail, pruneTrail, trailSample, trailBuckets } from "../lib/bixian-trail.js";
import {
  createResponder, adjudicate, nextMood, MOOD_PARAMS, runSpiritCall,
} from "../lib/bixian-responder.js";

// 仪式口诀（调研报告 §2.3：人民网版本的语序）
const CHANT_SUMMON = "笔仙笔仙，我是你的今生，你是我的前世，若要与我续缘，请在纸上画圈。";
const CHANT_SENDOFF = "笔仙笔仙，今日问事已毕，天光将晓，请你回去吧。";
const MAX_QUESTIONS = 5; // 一局至多五问（验笔是仪式脚本，不占问数；迷走亦不占）
const PERSONALITY = "steady"; // 请仙时的静息基准性格；越界/禁忌经 MOOD_PARAMS 转躁、升档
const STILL_PHASES = new Set(["idle", "returned", "settled"]); // 笔迹沥干后可停帧的相位
const CN_NUM = ["一", "二", "三", "四", "五"];
const SPIRIT_DRY = new Set(["quota", "exhausted"]); // 仙力竭尽的两种来路：429 实测 / 配额预判
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
  const moodRef = useRef("calm"); // 笔势：calm|restless|furious，越界转躁、触怒升档、随局持续
  const paramsRef = useRef(MOOD_PARAMS.calm); // 帧循环实际使用的漂移参数包（随笔势换）
  const [stage, setStage] = useState("entrance"); // entrance|summoning|verify|drift|divining|inquiry|sendoff|returned
  const stageRef = useRef(stage); // 异步裁决返回时核对局面未变（避免闭包旧 stage）
  stageRef.current = stage;
  const [questions, setQuestions] = useState([]); // 本局问事：{ q, answer, kind: verify|ask|stray, via?, cause? }
  const [input, setInput] = useState("");
  const [flash, setFlash] = useState(null); // 落定/回位反馈条
  const [fateNote, setFateNote] = useState(null); // 上问失准提示：{ q, reason }，可重问
  const [, setTick] = useState(0); // 帧驱动重绘

  const engine = engineRef.current;
  const phase = engine ? engine.phase : "idle";
  const askedCount = questions.filter((item) => item.kind === "ask").length;
  // 问事录口径：验笔是仪式脚本不入录；迷走也是一问（只是不占问数）
  const isAskedEntry = (item) => item.kind !== "verify";
  const hasInquired = questions.some(isAskedEntry);

  function flashOnce(label) {
    setFlash({ label });
    clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(null), 2800);
  }

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
      setQuestions((list) => [
        ...list,
        verifying
          ? { q: "你是笔仙吗？", answer: answer.label, kind: "verify" }
          : { q: lastQuestionRef.current, answer: answer.label, kind: "ask", via: verdictRef.current?.source ?? "spirit" },
      ]);
      if (fate) setFateNote({ q: lastQuestionRef.current, reason: verdictRef.current.reason ?? "call" });
      setStage("inquiry");
      return;
    }
    if (nextPhase === "strayed") {
      const cause = verdictRef.current?.cause === "taboo" ? "taboo" : "overstep";
      flashOnce(cause === "taboo" ? "触怒笔仙——扰动骤升，笔怒而迷走" : "此问越界——笔势转躁，笔自迷走");
      setQuestions((list) => [...list, { q: lastQuestionRef.current, answer: "迷走", kind: "stray", cause }]);
      setStage("inquiry");
      return;
    }
    if (nextPhase === "returned") {
      flashOnce("笔回位，仙已送走");
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
        const prevPhase = current.phase;
        step(current, dt, paramsRef.current, { holding: holdingRef.current, mode: "loose", pointer: null });
        if (current.phase !== prevPhase) handlePhaseRef.current(current.phase, prevPhase);
        // 着墨以扶笔为准：扶笔（笔尖受压于纸）才留痕；脱手停驻只剩微颤，不添新墨
        if (holdingRef.current && current.phase !== "idle" && current.phase !== "returned") {
          trailSample(trailRef.current, now / 1000, current.pos.x, current.pos.y);
        }
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
    };
  }, []);

  // —— 仪式指令 ——

  function beginSummon() {
    clearTimeout(flashTimerRef.current);
    const seed = ((Date.now() & 0xffff) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    const next = createDriftState({ rng: createRng(seed), personality: PERSONALITY });
    summon(next);
    engineRef.current = next;
    trailRef.current = createTrail();
    driftKindRef.current = null;
    lastQuestionRef.current = "";
    responderRef.current = createResponder(); // 同问缓存随局重建：上一局的裁决不带入新局
    verdictRef.current = null;
    moodRef.current = "calm"; // 笔势归静
    paramsRef.current = MOOD_PARAMS.calm;
    setQuestions([]);
    setInput("");
    setFlash(null);
    setFateNote(null);
    setStage("summoning");
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
    moodRef.current = nextMood(moodRef.current, verdict); // 越界转躁 / 触怒升档，随局持续
    paramsRef.current = MOOD_PARAMS[moodRef.current];
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

  // —— 扶笔（宽松式：按压即扶、抬手脱手停驻；笔位从不跟随指针）———

  function grabHold(event) {
    event.currentTarget.setPointerCapture(event.pointerId);
    holdingRef.current = true;
    setTick((n) => n + 1);
  }

  function releaseHold() {
    holdingRef.current = false;
    setTick((n) => n + 1);
  }

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
          <div className="bx-paper-wrap">
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
                onPointerDown={grabHold} onPointerUp={releaseHold} onPointerCancel={releaseHold}
              />
            </svg>
            {flash && <div className="bx-flash" key={flash.label}>{flash.label}</div>}
          </div>
          <aside className="bx-panel">
            {stage === "entrance" && (
              <div className="bx-card">
                <span className="bx-kicker">入局须知</span>
                <h2>夜静更深，铺纸请仙</h2>
                <p>一局之礼：请仙 → 验笔 → 问询 → 送仙 → 回位。至多五问，问毕必送，送必至回位。</p>
                <p>扶笔之法：按住纸面即扶笔，抬手笔自停驻；笔行于纸，不由人引。</p>
                <p className="bx-dim">戏中之事，纯属娱乐。</p>
                <button className="bx-primary" onClick={beginSummon}>点烛请仙 🕯️</button>
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
                <p className="bx-dim">{holding ? "扶笔勿离——笔自运行，蓄势而动，渐近乃止。" : "笔已停驻——按住纸面，续扶此笔。"}</p>
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
                {questions.some(isAskedEntry) && (
                  <div className="bx-log">
                    {(() => {
                      let askSeq = 0; // 问数只数 ask（迷走不占问数），故编号必在 CN_NUM 界内
                      return questions.filter(isAskedEntry).map((item, index) => (
                        <div key={`${index}-${item.q}`}>
                          <span>{item.kind === "ask" ? `问${CN_NUM[askSeq++]}` : item.cause === "taboo" ? "怒" : "越"}</span><em>{item.q}</em>
                          <b className={item.kind === "stray" || item.via === "fate" ? "bx-off" : ""}>
                            {item.answer}{item.via === "fate" ? "·天意" : ""}
                          </b>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </div>
            )}
            {stage === "sendoff" && (
              <div className="bx-card">
                <span className="bx-kicker">送仙 · 口诀</span>
                <p className="bx-chant">「{CHANT_SENDOFF}」</p>
                <p className="bx-dim">{holding ? "扶笔相送——笔回纸心，停稳即回位。" : "按住纸面扶笔，随笔回位。"}</p>
              </div>
            )}
            {stage === "returned" && (
              <div className="bx-card">
                <span className="bx-kicker">回位 · 归寂</span>
                <p className="bx-chant">仙已送回，纸面归寂。</p>
                <p className="bx-dim">笔迹与问事随烟而散，不留于纸。</p>
                <div className="bx-ask-row">
                  <button className="bx-primary" onClick={beginSummon}>再请一局</button>
                  <button className="bx-ghost" onClick={onExit}>回大厅</button>
                </div>
              </div>
            )}
          </aside>
        </div>
        {drifting && !holding && <div className="bx-hint">笔已停驻 · 按住纸面续扶</div>}
      </div>
    </main>
  );
}
