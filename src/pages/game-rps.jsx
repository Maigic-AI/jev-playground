import React, { useEffect, useRef, useState } from "react";
import {
  CONFIGS, HUMAN, MOVE_CN, MOVE_EMOJI, buildRpsPayload, configById, decodeSeat, judge,
  normalizeProbabilities, pickMove, randomMove, runRpsRound,
} from "../lib/rps.js";
import { recordRoundHuman, recordRoundSim } from "../lib/rps-stats.js";

const MIN_SHAKE_MS = 900;
const CHANT = ["石头", "剪刀", "布"];
const UI_ORDER = ["rock", "scissors", "paper"];
const SPEEDS = { slow: { label: "慢速", revealMs: 900 }, normal: { label: "标准", revealMs: 450 }, fast: { label: "快速", revealMs: 180 } };
const ROUND_PRESETS = [10, 20, 50, 100];
const MAX_ROUNDS = 200;
const STRATEGY_LABEL = { sample: "按概率抽样", argmax: "总取最优" };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampRounds(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(MAX_ROUNDS, Math.max(1, parsed));
}

function seatName(seat) {
  return seat.config.id === "human" ? "你" : seat.config.name;
}

function outcomeFrom(history, seatId) {
  const last = history[history.length - 1];
  if (!last) return null;
  if (last.result === "draw") return "draw";
  return last.result === seatId ? "win" : "lose";
}

export default function RpsGame({ mode, onMode, apiKey, onKey, quota, onQuota, onStats, onExit }) {
  const [phase, setPhase] = useState("setup");
  const [configA, setConfigA] = useState("win3");
  const [configB, setConfigB] = useState("win5");
  const [strategy, setStrategy] = useState("sample");
  const [roundsInput, setRoundsInput] = useState("10");
  const [speed, setSpeed] = useState("normal");
  const [notice, setNotice] = useState("");
  const [match, setMatch] = useState(null);
  const [roundState, setRoundState] = useState("idle");
  const [current, setCurrent] = useState(null);
  const [liveRound, setLiveRound] = useState(1);
  const [errorInfo, setErrorInfo] = useState(null);
  const [simError, setSimError] = useState(null);
  const [stopped, setStopped] = useState(false);
  const [autoStopped, setAutoStopped] = useState(false);
  const [simElapsed, setSimElapsed] = useState(0);

  // 模拟循环中实时读取的最新策略 / 速度（避免闭包拿到旧值）
  const strategyRef = useRef(strategy);
  strategyRef.current = strategy;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const cancelRef = useRef(false);
  const abortRef = useRef(null);
  const pendingRef = useRef(null);
  const failStreakRef = useRef(0);
  const simRef = useRef(null);

  const seats = mode === "human"
    ? [{ id: "you", config: HUMAN }, { id: "jev", config: configById(configA) }]
    : [{ id: "seat_a", config: configById(configA) }, { id: "seat_b", config: configById(configB) }];
  const totalRounds = clampRounds(roundsInput);

  // —— 人机对战 ——

  async function playMove(humanMove) {
    if (phase !== "playing" || roundState !== "idle") return;
    const config = configById(configA);
    if (config.usesApi && !apiKey && quota && quota.remaining < 1) {
      setNotice("今日默认 API 已用完。填写自己的 key 可以继续，或选择「随机」配置纯本地玩。");
      onKey();
      return;
    }
    setNotice("");
    pendingRef.current = humanMove;
    setCurrent(null);
    setRoundState("shaking");
    const startedAt = performance.now();
    try {
      let decision = null;
      let model = null;
      const minShake = sleep(MIN_SHAKE_MS);
      if (config.usesApi) {
        const body = await runRpsRound(
          buildRpsPayload({ round: match.history.length + 1, history: match.history, score: match.score, seats }),
          { apiKey, onQuota },
        );
        decision = decodeSeat(body, "jev_throw");
        model = body.model;
      }
      await minShake;
      failStreakRef.current = 0;
      settleHumanRound(humanMove, decision, model, Math.round(performance.now() - startedAt), false);
    } catch (error) {
      if (error.quota) onQuota(error.quota);
      failStreakRef.current += 1;
      setErrorInfo({ message: error.message, move: humanMove, streak: failStreakRef.current });
      setRoundState("error");
    }
  }

  function settleHumanRound(humanMove, decision, model, apiMs, forcedRandom) {
    const config = configById(configA);
    let playedMove;
    let fallback = null;
    const probabilities = decision?.probabilities ?? null;
    if (!config.usesApi) playedMove = randomMove();
    else if (forcedRandom) {
      playedMove = randomMove();
      fallback = "random";
    } else {
      playedMove = pickMove(probabilities, strategyRef.current);
      if (!normalizeProbabilities(probabilities)) fallback = "random";
    }
    const outcome = judge(humanMove, playedMove);
    const result = outcome === "win" ? "you" : outcome === "lose" ? "jev" : "draw";
    const record = {
      round: match.history.length + 1,
      moves: { you: humanMove, jev: playedMove },
      result,
      decisions: config.usesApi ? { jev: { choice: decision?.choice ?? null, confidence: decision?.confidence ?? 0, probabilities, playedMove, strategy: strategyRef.current, fallback } } : {},
      model: config.usesApi ? model : null,
      apiMs: config.usesApi ? apiMs : 0,
    };
    setMatch((currentMatch) => ({
      ...currentMatch,
      history: [...currentMatch.history, record],
      score: { ...currentMatch.score, [result]: currentMatch.score[result] + 1 },
    }));
    onStats((prev) => recordRoundHuman(prev, { configId: config.id, humanMove, jevMove: playedMove, result: outcome }));
    setCurrent(record);
    setErrorInfo(null);
    setRoundState("reveal");
    setTimeout(() => setRoundState((state) => (state === "reveal" ? "idle" : state)), 700);
  }

  async function retryRound() {
    const humanMove = pendingRef.current;
    if (!humanMove || roundState !== "error") return;
    setRoundState("shaking");
    setErrorInfo(null);
    const startedAt = performance.now();
    try {
      const body = await runRpsRound(
        buildRpsPayload({ round: match.history.length + 1, history: match.history, score: match.score, seats }),
        { apiKey, onQuota },
      );
      failStreakRef.current = 0;
      settleHumanRound(humanMove, decodeSeat(body, "jev_throw"), body.model, Math.round(performance.now() - startedAt), false);
    } catch (error) {
      if (error.quota) onQuota(error.quota);
      failStreakRef.current += 1;
      setErrorInfo({ message: error.message, move: humanMove, streak: failStreakRef.current });
      setRoundState("error");
    }
  }

  function fallbackThisRound() {
    if (roundState !== "error" || !pendingRef.current) return;
    failStreakRef.current = 0;
    settleHumanRound(pendingRef.current, null, null, 0, true);
  }

  // —— 配置与开局 ——

  function startGame() {
    const needsApi = seats.some((seat) => seat.config.usesApi);
    if (needsApi && !apiKey && quota && !quota.available) {
      setNotice("本站暂未配置默认 API，请先填写自己的 API key 再开局。");
      onKey();
      return;
    }
    if (needsApi && !apiKey && quota && mode === "sim" && quota.remaining < totalRounds) {
      setNotice(`今日默认 API 仅剩 ${quota.remaining} 次，这次模拟约需 ${totalRounds} 次。请填写自己的 API key，或减少局数。`);
      onKey();
      return;
    }
    setNotice("");
    failStreakRef.current = 0;
    if (mode === "human") {
      setMatch({ history: [], score: { you: 0, jev: 0, draw: 0 }, seats });
      setCurrent(null);
      setRoundState("idle");
      setPhase("playing");
      return;
    }
    simRef.current = {
      seats,
      needsApi,
      totalRounds,
      nextRound: 1,
      history: [],
      score: { seat_a: 0, seat_b: 0, draw: 0 },
      failStreak: 0,
      startedAt: performance.now(),
    };
    cancelRef.current = false;
    abortRef.current = new AbortController();
    setMatch({ history: [], score: { seat_a: 0, seat_b: 0, draw: 0 }, seats });
    setCurrent(null);
    setStopped(false);
    setAutoStopped(false);
    setSimError(null);
    setSimElapsed(0);
    setPhase("playing");
    runSimLoop();
  }

  // 严格串行：下一回合的 state 依赖本回合的采样结果
  async function runSimLoop() {
    const sim = simRef.current;
    setSimError(null);
    while (sim.nextRound <= sim.totalRounds && !cancelRef.current) {
      const round = sim.nextRound;
      setLiveRound(round);
      setCurrent(null);
      setRoundState("shaking");
      const startedAt = performance.now();
      let body = null;
      if (sim.needsApi) {
        try {
          body = await runRpsRound(
            buildRpsPayload({ round, history: sim.history, score: sim.score, seats: sim.seats }),
            { apiKey, onQuota, signal: abortRef.current.signal },
          );
          sim.failStreak = 0;
        } catch (error) {
          if (cancelRef.current || error.name === "AbortError") break;
          if (error.quota) onQuota(error.quota);
          sim.failStreak += 1;
          if (sim.failStreak >= 3) {
            setAutoStopped(true);
            break;
          }
          setSimError({ round, message: error.message });
          setRoundState("error");
          return; // 重试后从 sim.nextRound 继续
        }
      }
      const moves = {};
      const decisions = {};
      for (const seat of sim.seats) {
        if (seat.config.usesApi) {
          const decoded = decodeSeat(body, `${seat.id}_throw`);
          const probabilities = decoded?.probabilities ?? null;
          moves[seat.id] = pickMove(probabilities, strategyRef.current);
          decisions[seat.id] = {
            choice: decoded?.choice ?? null,
            confidence: decoded?.confidence ?? 0,
            probabilities,
            playedMove: moves[seat.id],
            strategy: strategyRef.current,
            fallback: normalizeProbabilities(probabilities) ? null : "random",
          };
        } else {
          moves[seat.id] = randomMove();
        }
      }
      const outcome = judge(moves.seat_a, moves.seat_b);
      const result = outcome === "draw" ? "draw" : outcome === "win" ? "seat_a" : "seat_b";
      const record = { round, moves, result, decisions, model: body?.model ?? null, apiMs: body ? Math.round(performance.now() - startedAt) : 0 };
      sim.history.push(record);
      sim.score[result] += 1;
      sim.nextRound = round + 1;
      // recordRoundSim 的 result 契约是 "a"|"b"|"draw"（座位视角），而 result 是获胜座位 id，供计分与回合记录使用
      onStats((prev) => recordRoundSim(prev, { aId: sim.seats[0].config.id, bId: sim.seats[1].config.id, aMove: moves.seat_a, bMove: moves.seat_b, result: outcome === "win" ? "a" : outcome === "lose" ? "b" : "draw" }));
      setMatch({ history: [...sim.history], score: { ...sim.score }, seats: sim.seats });
      setCurrent(record);
      setRoundState("reveal");
      await sleep(SPEEDS[speedRef.current].revealMs);
    }
    setSimElapsed(Math.round(performance.now() - sim.startedAt));
    setPhase("done");
    setStopped(cancelRef.current);
  }

  function stopSim() {
    cancelRef.current = true;
    abortRef.current?.abort();
    // 循环可能在错误暂停中（不在跑），需要直接收尾；正常跑动时循环自己也会走到 done
    setSimElapsed(Math.round(performance.now() - simRef.current.startedAt));
    setStopped(true);
    setPhase("done");
  }

  if (phase === "setup") {
    return (
      <main className="rps-page wrap-narrow">
        <SetupPanel
          mode={mode}
          onMode={onMode}
          configA={configA}
          setConfigA={setConfigA}
          configB={configB}
          setConfigB={setConfigB}
          strategy={strategy}
          setStrategy={setStrategy}
          roundsInput={roundsInput}
          setRoundsInput={setRoundsInput}
          totalRounds={totalRounds}
          speed={speed}
          setSpeed={setSpeed}
          apiKey={apiKey}
          quota={quota}
          needsApi={seats.some((seat) => seat.config.usesApi)}
          notice={notice}
          onStart={startGame}
          onExit={onExit}
        />
      </main>
    );
  }

  if (mode === "human") {
    return (
      <main className="rps-page wrap-narrow">
        <HumanMatch
          match={match}
          seats={seats}
          roundState={roundState}
          current={current}
          errorInfo={errorInfo}
          strategy={strategy}
          setStrategy={setStrategy}
          notice={notice}
          playMove={playMove}
          retryRound={retryRound}
          fallbackThisRound={fallbackThisRound}
          onExit={onExit}
        />
      </main>
    );
  }

  return (
    <main className="rps-page wrap-narrow">
      <SimMatch
        match={match}
        seats={seats}
        phase={phase}
        roundState={roundState}
        current={current}
        liveRound={liveRound}
        totalRounds={totalRounds}
        simError={simError}
        stopped={stopped}
        autoStopped={autoStopped}
        simElapsed={simElapsed}
        speed={speed}
        setSpeed={setSpeed}
        strategy={strategy}
        notice={notice}
        retryRound={runSimLoop}
        stopSim={stopSim}
        onAgain={() => setPhase("setup")}
        onExit={onExit}
      />
    </main>
  );
}

function ConfigPicker({ label, value, onChange }) {
  return (
    <div className="config-field">
      <span className="config-label">{label}</span>
      <div className="config-row">
        {CONFIGS.map((config) => (
          <button key={config.id} type="button" className={`config-option ${value === config.id ? "active" : ""}`} onClick={() => onChange(config.id)}>
            <span className="config-emoji">{config.emoji}</span>
            <strong>{config.name}</strong>
            <small>{config.note}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function SetupPanel({
  mode, onMode, configA, setConfigA, configB, setConfigB, strategy, setStrategy,
  roundsInput, setRoundsInput, totalRounds, speed, setSpeed, apiKey, quota, needsApi, notice, onStart, onExit,
}) {
  const randomOnly = mode === "human" ? configA === "random" : configA === "random" && configB === "random";
  const estimated = needsApi ? (mode === "sim" ? totalRounds : 1) : 0;
  return (
    <section className="rps-setup">
      <div className="quiz-meta">
        <button className="round-button" onClick={onExit} aria-label="回大厅">×</button>
        <div><strong>猜拳 · 开局设置</strong><span>ROOM 02 · 游戏室</span></div>
        <b className="rps-kicker">✊✋✌️</b>
      </div>

      <div className="config-field">
        <span className="config-label">对战模式</span>
        <div className="rps-switch">
          <button type="button" className={mode === "human" ? "active" : ""} onClick={() => onMode("human")}>人机对战</button>
          <button type="button" className={mode === "sim" ? "active" : ""} onClick={() => onMode("sim")}>Jev 对 Jev 模拟</button>
        </div>
      </div>

      {mode === "human" ? (
        <ConfigPicker label="Jev 用哪种配置？" value={configA} onChange={setConfigA} />
      ) : (
        <React.Fragment>
          <ConfigPicker label="选手 A" value={configA} onChange={setConfigA} />
          <ConfigPicker label="选手 B" value={configB} onChange={setConfigB} />
        </React.Fragment>
      )}

      <div className="config-field">
        <span className="config-label">Jev 出招策略{randomOnly ? "（双方均为随机时无效）" : ""}</span>
        <div className="rps-switch">
          <button type="button" className={strategy === "sample" ? "active" : ""} onClick={() => setStrategy("sample")}>按概率抽样</button>
          <button type="button" className={strategy === "argmax" ? "active" : ""} onClick={() => setStrategy("argmax")}>总取最优</button>
        </div>
        <small className="config-hint">{strategy === "sample" ? "Jev 返回 石头/剪刀/布 的概率后按权重抽样，同一局面也会出不一样的招。" : "永远出 Jev 概率最高的招，更稳但容易被针对。"}</small>
      </div>

      {mode === "sim" && (
        <React.Fragment>
          <div className="config-field">
            <span className="config-label">模拟总局次</span>
            <div className="rps-switch">
              {ROUND_PRESETS.map((preset) => (
                <button type="button" key={preset} className={roundsInput === String(preset) ? "active" : ""} onClick={() => setRoundsInput(String(preset))}>{preset} 局</button>
              ))}
              <label className="rounds-input">自定义
                <input
                  type="number" min={1} max={MAX_ROUNDS} value={roundsInput}
                  onChange={(event) => setRoundsInput(event.target.value)}
                  onBlur={(event) => setRoundsInput(String(clampRounds(event.target.value)))}
                />
              </label>
            </div>
            <small className="config-hint">最多 {MAX_ROUNDS} 局。两个 Jev 对战时每回合合并为一次 API 调用。</small>
          </div>
          <div className="config-field">
            <span className="config-label">播放速度</span>
            <div className="rps-switch">
              {Object.entries(SPEEDS).map(([key, value]) => (
                <button type="button" key={key} className={speed === key ? "active" : ""} onClick={() => setSpeed(key)}>{value.label}</button>
              ))}
            </div>
          </div>
        </React.Fragment>
      )}

      {notice && <div className="notice">{notice}</div>}

      <div className="setup-foot">
        <small>{needsApi ? `预计每次对局消耗 ${estimated} 次 API · 今日剩余 ${!apiKey && quota ? quota.remaining : "不限"} 次` : "双方均为随机配置：完全本地进行，不调用 API"}</small>
        <button className="next-button" onClick={onStart}>{mode === "human" ? "开始对战 ✊" : `开始 ${totalRounds} 局模拟 ▶`}</button>
      </div>
    </section>
  );
}

function Arena({ seats, roundState, current, chant, thinking, banner }) {
  const revealed = roundState !== "shaking" && current;
  const leftMove = revealed ? current.moves[seats[0].id] : "rock";
  const rightMove = revealed ? current.moves[seats[1].id] : "rock";
  const handClass = roundState === "shaking" ? "shaking" : revealed ? "revealed" : "";
  const vsText = roundState === "shaking" ? (thinking ? "想…" : chant) : "VS";
  return (
    <div className="rps-arena">
      {revealed && banner && roundState !== "error" && <div className={`rps-banner ${banner.tone}`}>{banner.text}</div>}
      <div className="rps-seat">
        <div className={`rps-hand left ${handClass}`}><span key={`l${current ? current.round : 0}${leftMove}`}>{MOVE_EMOJI[leftMove]}</span></div>
        <small>{seatName(seats[0])}</small>
      </div>
      <div className="rps-vs">{vsText}</div>
      <div className="rps-seat">
        <div className={`rps-hand right ${handClass}`}><span key={`r${current ? current.round : 0}${rightMove}`}>{MOVE_EMOJI[rightMove]}</span></div>
        <small>{seatName(seats[1])}</small>
      </div>
    </div>
  );
}

function scoreChips(score, labels) {
  return (
    <div className="rps-score">
      <span className="score-chip">{labels[0]} <b>{score[0]}</b></span>
      <span className="score-chip">{labels[1]} <b>{score[1]}</b></span>
      <span className="score-chip">平 <b>{score[2]}</b></span>
    </div>
  );
}

function HumanMatch({ match, seats, roundState, current, errorInfo, strategy, setStrategy, notice, playMove, retryRound, fallbackThisRound, onExit }) {
  const [chantIndex, setChantIndex] = useState(0);
  const [thinking, setThinking] = useState(false);
  const jevConfig = seats[1].config;

  useEffect(() => {
    if (roundState !== "shaking") { setThinking(false); return undefined; }
    const chantTimer = setInterval(() => setChantIndex((index) => (index + 1) % 3), 300);
    const thinkTimer = setTimeout(() => setThinking(true), 1500);
    return () => { clearInterval(chantTimer); clearTimeout(thinkTimer); };
  }, [roundState]);

  if (!match) return null;
  const outcome = current ? outcomeFrom([current], "you") : null;
  const banner = outcome ? { tone: outcome === "win" ? "win" : outcome === "lose" ? "lose" : "draw", text: outcome === "win" ? "你赢了 🎉" : outcome === "lose" ? "Jev 赢了" : "平局" } : null;

  return (
    <React.Fragment>
      <div className="quiz-meta">
        <button className="round-button" onClick={onExit} aria-label="回大厅">×</button>
        <div><strong>猜拳 · 人机对战</strong><span>Jev 配置：{jevConfig.name} · 第 {match.history.length + (roundState === "reveal" ? 0 : 1)} 回合</span></div>
        <div className="rps-switch small">
          <button type="button" className={strategy === "sample" ? "active" : ""} onClick={() => setStrategy("sample")}>抽样</button>
          <button type="button" className={strategy === "argmax" ? "active" : ""} onClick={() => setStrategy("argmax")}>最优</button>
        </div>
      </div>
      {notice && <div className="notice">{notice}</div>}
      {scoreChips([match.score.you, match.score.jev, match.score.draw], ["你", "Jev"])}
      <Arena seats={seats} roundState={roundState} current={current} chant={CHANT[chantIndex]} thinking={thinking} banner={banner} />
      {roundState === "error" && errorInfo ? (
        <div className="rps-error">
          <strong>这一回合调用失败：{errorInfo.message}</strong>
          {errorInfo.streak >= 3 && <p>已连续失败 {errorInfo.streak} 次，建议检查 API 状态，或先用随机代打继续。</p>}
          <div className="rps-error-actions">
            <button className="next-button" onClick={retryRound}>重试本回合</button>
            <button className="back-button" onClick={fallbackThisRound}>随机代打这一手</button>
            <button className="back-button" onClick={onExit}>结束回大厅</button>
          </div>
        </div>
      ) : (
        <div className="rps-moves">
          {UI_ORDER.map((move) => (
            <button key={move} className="move-button" disabled={roundState !== "idle"} onClick={() => playMove(move)}>
              <span>{MOVE_EMOJI[move]}</span>
              <small>{MOVE_CN[move]}</small>
            </button>
          ))}
        </div>
      )}
      <JevPanel config={jevConfig} decision={current?.decisions?.jev} record={current} />
      {match.history.length > 0 && <RoundLog history={match.history} seatId="you" seats={seats} />}
    </React.Fragment>
  );
}

function ProbabilityBars({ probabilities, highlight }) {
  return (
    <div className="probability-list">
      {UI_ORDER.map((move) => (
        <div key={move} className={highlight === move ? "played" : ""}>
          <span>{MOVE_CN[move]}</span>
          <i><b style={{ width: `${Math.round((probabilities[move] || 0) * 100)}%` }} /></i>
          <em>{Math.round((probabilities[move] || 0) * 100)}%</em>
        </div>
      ))}
    </div>
  );
}

function JevPanel({ config, decision, record }) {
  if (!config.usesApi) {
    return (
      <section className="rps-panel">
        <div className="panel-title"><span>01</span><h2>Jev 的内心概率</h2><b>RANDOM</b></div>
        <ProbabilityBars probabilities={{ rock: 1 / 3, paper: 1 / 3, scissors: 1 / 3 }} />
        <p className="model-line">均匀分布 · 不经 Jev</p>
      </section>
    );
  }
  if (!decision) {
    return (
      <section className="rps-panel">
        <div className="panel-title"><span>01</span><h2>Jev 的内心概率</h2><b className="pink">LIVE</b></div>
        <div className="missing-result"><span>⌁</span><div><strong>出招后揭晓</strong><p>这里会展示 Jev 每一掷的概率分布、首选与置信度。</p></div></div>
      </section>
    );
  }
  const normalized = normalizeProbabilities(decision.probabilities) || { rock: 1 / 3, paper: 1 / 3, scissors: 1 / 3 };
  const sampled = decision.playedMove !== decision.choice;
  return (
    <section className="rps-panel">
      <div className="panel-title"><span>01</span><h2>Jev 的内心概率</h2><b className="pink">LIVE</b></div>
      <div className="jev-choice">
        <div>
          <span>首选</span>
          <strong>{decision.choice ? MOVE_CN[decision.choice] : "—"}</strong>
          <small>置信度 {Math.round(decision.confidence * 100)}%</small>
        </div>
        <div className="rps-panel-bars">
          <ProbabilityBars probabilities={normalized} highlight={decision.playedMove} />
          <p className="sampled-note">
            {decision.fallback === "random" ? "概率不可用 · 本回合随机代打" : decision.strategy === "argmax" ? "取最优策略出招" : sampled ? `本次按概率抽样出「${MOVE_CN[decision.playedMove]}」` : "抽样结果与首选一致"}
          </p>
        </div>
      </div>
      {record?.model && <p className="model-line">{record.model} · 延迟 {record.apiMs}ms</p>}
    </section>
  );
}

function RoundLog({ history, seatId, seats }) {
  const shown = history.slice(-14);
  return (
    <div className="rps-log-wrap">
      <span className="mini-label-dim">近 {shown.length} 回合</span>
      <div className="rps-log">
        {shown.map((record) => {
          const outcome = record.result === "draw" ? "draw" : record.result === seatId ? "win" : "lose";
          return (
            <span key={record.round} className={`round-chip ${outcome}`}>
              R{record.round} {MOVE_EMOJI[record.moves[seats[0].id]]}×{MOVE_EMOJI[record.moves[seats[1].id]]} {outcome === "win" ? "胜" : outcome === "lose" ? "负" : "平"}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function SimMatch({ match, seats, phase, roundState, current, liveRound, totalRounds, simError, stopped, autoStopped, simElapsed, speed, setSpeed, strategy, notice, retryRound, stopSim, onAgain, onExit }) {
  if (!match) return null;
  const playing = phase === "playing";
  const outcome = current ? outcomeFrom([current], seats[0].id) : null;
  const banner = outcome ? { tone: outcome === "win" ? "win" : outcome === "lose" ? "lose" : "draw", text: outcome === "win" ? `${seatName(seats[0])} 胜` : outcome === "lose" ? `${seatName(seats[1])} 胜` : "平局" } : null;
  return (
    <React.Fragment>
      <div className="quiz-meta">
        <button className="round-button" onClick={onExit} aria-label="回大厅">×</button>
        <div><strong>猜拳 · 模拟对战</strong><span>{seats[0].config.name} vs {seats[1].config.name} · {STRATEGY_LABEL[strategy]}</span></div>
        {playing ? <b>{Math.min(liveRound, totalRounds)}<small> / {totalRounds}</small></b> : <b>{match.history.length}<small> / {totalRounds}</small></b>}
      </div>
      {notice && <div className="notice">{notice}</div>}
      {scoreChips([match.score.seat_a, match.score.seat_b, match.score.draw], [seatName(seats[0]), seatName(seats[1])])}
      <div className="progress-track rps-progress"><div style={{ width: `${Math.min(100, match.history.length / totalRounds * 100)}%` }} /></div>
      <Arena seats={seats} roundState={roundState} current={current} chant={CHANT[liveRound % 3]} thinking banner={banner} />
      {playing && (
        <div className="sim-controls">
          <div className="rps-switch small">
            {Object.entries(SPEEDS).map(([key, value]) => (
              <button type="button" key={key} className={speed === key ? "active" : ""} onClick={() => setSpeed(key)}>{value.label}</button>
            ))}
          </div>
          {roundState === "error" && simError ? (
            <div className="sim-error-inline">
              <span>第 {simError.round} 回合调用失败：{simError.message}</span>
              <button className="next-button" onClick={retryRound}>重试本轮</button>
              <button className="back-button" onClick={stopSim}>停止模拟</button>
            </div>
          ) : <button className="back-button" onClick={stopSim}>■ 停止模拟</button>}
        </div>
      )}
      {current && <SimRoundPanel current={current} seats={seats} />}
      {match.history.length > 0 && <RoundLog history={match.history} seatId={seats[0].id} seats={seats} />}
      {phase === "done" && (
        <SimResult
          match={match}
          seats={seats}
          stopped={stopped}
          autoStopped={autoStopped}
          simElapsed={simElapsed}
          onAgain={onAgain}
          onExit={onExit}
        />
      )}
    </React.Fragment>
  );
}

function SimRoundPanel({ current, seats }) {
  const apiSeats = seats.filter((seat) => current.decisions[seat.id]);
  if (!apiSeats.length) return null;
  return (
    <section className="rps-panel">
      <div className="panel-title"><span>01</span><h2>本回合双方概率</h2><b className="pink">LIVE</b></div>
      <div className="sim-probability-grid">
        {apiSeats.map((seat) => {
          const decision = current.decisions[seat.id];
          const normalized = normalizeProbabilities(decision.probabilities) || { rock: 1 / 3, paper: 1 / 3, scissors: 1 / 3 };
          return (
            <div key={seat.id}>
              <span className="sim-seat-name">{seatName(seat)} · 首选 {decision.choice ? MOVE_CN[decision.choice] : "—"} {Math.round(decision.confidence * 100)}%</span>
              <ProbabilityBars probabilities={normalized} highlight={decision.playedMove} />
            </div>
          );
        })}
      </div>
      {current.model && <p className="model-line">{current.model} · 延迟 {current.apiMs}ms</p>}
    </section>
  );
}

function MoveDistribution({ name, moves }) {
  const total = UI_ORDER.reduce((sum, move) => sum + moves[move], 0);
  return (
    <div className="sim-move-block">
      <span className="sim-seat-name">{name}</span>
      <ProbabilityBars probabilities={total ? Object.fromEntries(UI_ORDER.map((move) => [move, moves[move] / total])) : { rock: 0, paper: 0, scissors: 0 }} />
      <small className="config-hint">出招 {UI_ORDER.map((move) => `${MOVE_CN[move]} ${moves[move]}`).join(" · ")} · 共 {total} 掷</small>
    </div>
  );
}

function SimResult({ match, seats, stopped, autoStopped, simElapsed, onAgain, onExit }) {
  const { history, score } = match;
  const total = history.length;
  const rate = (value) => (total ? Math.round((value / total) * 100) : 0);
  const apiRounds = history.filter((record) => record.model).length;
  const avgLatency = apiRounds ? Math.round(history.reduce((sum, record) => sum + record.apiMs, 0) / apiRounds) : 0;
  return (
    <section className="rps-final">
      <div className="panel-title"><span>02</span><h2>模拟结果</h2><b>{stopped ? "已中止" : "完赛"}</b></div>
      {(stopped || autoStopped) && (
        <div className="result-note"><strong>{autoStopped ? "连续 3 次请求失败，已自动停止" : `已手动停止于第 ${total} 回合`}</strong><p>以下统计基于已完成的回合。</p></div>
      )}
      <div className="run-stats">
        <div><span>{seatName(seats[0])} 胜率</span><strong>{rate(score.seat_a)}%</strong></div>
        <div><span>{seatName(seats[1])} 胜率</span><strong>{rate(score.seat_b)}%</strong></div>
        <div><span>平局占比</span><strong>{rate(score.draw)}%</strong></div>
        <div><span>总耗时</span><strong>{(simElapsed / 1000).toFixed(1)}s{avgLatency ? ` · 均延迟 ${avgLatency}ms` : ""}</strong></div>
      </div>
      <p className="sim-score-line">{seatName(seats[0])} {score.seat_a} : {score.seat_b} {seatName(seats[1])} · 平 {score.draw} · 共 {total} 回合</p>
      <div className="sim-move-grid">
        <MoveDistribution name={`${seatName(seats[0])} 出招分布`} moves={aggregateMoves(history, "seat_a")} />
        <MoveDistribution name={`${seatName(seats[1])} 出招分布`} moves={aggregateMoves(history, "seat_b")} />
      </div>
      <div className="result-actions">
        <button className="next-button" onClick={onAgain}>再来一局</button>
        <button className="back-button" onClick={onExit}>回大厅</button>
      </div>
    </section>
  );
}

function aggregateMoves(history, seatId) {
  const moves = { rock: 0, paper: 0, scissors: 0 };
  for (const record of history) moves[record.moves[seatId]] += 1;
  return moves;
}
