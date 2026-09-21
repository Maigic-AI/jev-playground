import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { buildJevPayload, catalog, loadTest } from "./lib/catalog.js";
import { runJevQuestionnaire } from "./lib/auto-run.js";
import { clearDraft, deleteResult, readDraft, readHistory, saveDraft, saveResult } from "./lib/history.js";
import { percentPair } from "./lib/scoring.js";
import "./styles.css";

const localeName = { zh: "中文", en: "English" };

function App() {
  const [view, setView] = useState("home");
  const [apiKey, setApiKey] = useState("");
  const [keyOpen, setKeyOpen] = useState(false);
  const [history, setHistory] = useState(readHistory);
  const [session, setSession] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [runProgress, setRunProgress] = useState(null);
  const [notice, setNotice] = useState("");
  const draft = useMemo(readDraft, []);

  async function startTest(item, locale = item.languages[0], restore = null, variant = restore?.variant || item.variants?.[0]) {
    setLoading(true);
    try {
      const test = await loadTest(item.id, locale, variant);
      setSession({ test, answers: restore?.answers || {}, index: restore?.index || 0 });
      setView("quiz");
      setNotice("");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function startAuto(item, locale = item.languages[0], variant = item.variants?.[0]) {
    if (!apiKey) {
      setNotice("先填写 API key，再启动 Jev 自动跑测。");
      setKeyOpen(true);
      return;
    }
    setLoading(true);
    setRunProgress({ batch: 0, batches: 1, answered: 0, total: 0 });
    setNotice("");
    try {
      const test = await loadTest(item.id, locale, variant);
      const { standard, run } = await runJevQuestionnaire(test, apiKey, setRunProgress);
      const completed = {
        id: crypto.randomUUID(),
        runMode: "auto",
        testId: test.id,
        testTitle: test.title,
        locale: test.locale,
        createdAt: new Date().toISOString(),
        standard,
        jevRun: run,
        jev: null,
        source: test.source,
      };
      setResult(completed);
      setHistory(saveResult(completed));
      setView("result");
    } catch (error) {
      setNotice(`自动跑测失败：${error.message}`);
      setView("home");
    } finally {
      setLoading(false);
      setRunProgress(null);
    }
  }

  function choose(value) {
    setSession((current) => {
      const answers = { ...current.answers, [current.test.questions[current.index].id]: value };
      const next = { ...current, answers };
      saveDraft({ testId: current.test.id, locale: current.test.locale, variant: current.test.variant, answers, index: current.index });
      return next;
    });
  }

  async function finish() {
    const standard = session.test.score(session.answers);
    setLoading(true);
    let jev = null;
    let apiError = null;
    if (apiKey) {
      try {
        const payload = buildJevPayload(session.test, session.answers);
        const response = await fetch("/api/system-one", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey, ...payload }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Jev 请求失败");
        jev = body;
      } catch (error) {
        apiError = error.message;
      }
    }
    const completed = {
      id: crypto.randomUUID(),
      testId: session.test.id,
      testTitle: session.test.title,
      locale: session.test.locale,
      createdAt: new Date().toISOString(),
      standard,
      jev,
      apiError,
      source: session.test.source,
    };
    setResult(completed);
    setHistory(saveResult(completed));
    clearDraft();
    setView("result");
    setLoading(false);
  }

  function next() {
    if (session.index === session.test.questions.length - 1) finish();
    else setSession((current) => {
      const next = { ...current, index: current.index + 1 };
      saveDraft({ testId: current.test.id, locale: current.test.locale, variant: current.test.variant, answers: current.answers, index: next.index });
      return next;
    });
  }

  function openSaved(item) {
    setResult(item);
    setView("result");
  }

  function goHome() {
    setSession(null);
    setView("home");
  }

  return (
    <div className="app-shell">
      <Header view={view} goHome={goHome} apiKey={apiKey} onKey={() => setKeyOpen(true)} />
      {view === "home" && (
        <Home
          history={history}
          draft={draft}
          startTest={startTest}
          startAuto={startAuto}
          openSaved={openSaved}
          loading={loading}
          notice={notice}
          remove={(id) => setHistory(deleteResult(id))}
        />
      )}
      {view === "quiz" && session && (
        <Quiz session={session} setSession={setSession} choose={choose} next={next} loading={loading} goHome={goHome} />
      )}
      {view === "result" && result && <Result result={result} goHome={goHome} />}
      {keyOpen && <KeySheet value={apiKey} onChange={setApiKey} onClose={() => setKeyOpen(false)} />}
      {loading && <LoadingOverlay progress={runProgress} />}
    </div>
  );
}

function Header({ view, goHome, apiKey, onKey }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={goHome} aria-label="返回首页">
        <span className="brand-mark">J</span><span>Jev Pop Lab</span>
      </button>
      <div className="topbar-actions">
        {view !== "home" && <button className="ghost-button" onClick={goHome}>题库</button>}
        <button className={`key-button ${apiKey ? "connected" : ""}`} onClick={onKey}>
          <span className="status-dot" />{apiKey ? "API 已就绪" : "填写 API"}
        </button>
      </div>
    </header>
  );
}

function Home({ history, draft, startTest, startAuto, openSaved, loading, notice, remove }) {
  return (
    <main>
      <section className="hero wrap">
        <div className="hero-copy">
          <span className="eyebrow">JEV AUTO TEST · 全程记录</span>
          <h1>选一套题，<br /><em>让 Jev 自己做</em></h1>
          <p>自动跑完整套题，逐题记录选择、概率与置信度。重复运行，还能观察结果是否稳定。</p>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-card orbit-one"><strong>30/30</strong><span>自动作答完成</span></div>
          <div className="orbit-card orbit-two"><strong>SOLO</strong><span>本次跑测结果</span></div>
          <div className="spark spark-a">✦</div><div className="spark spark-b">✿</div>
        </div>
      </section>

      {notice && <div className="wrap notice">{notice}</div>}

      {draft && (
        <section className="wrap resume-card">
          <div><span className="mini-label">未完成</span><h3>上次答到一半，要继续吗？</h3></div>
          <button className="dark-button" disabled={loading} onClick={() => {
            const item = catalog.find((entry) => entry.id === draft.testId);
            startTest(item, draft.locale, draft, draft.variant);
          }}>继续作答 →</button>
        </section>
      )}

      <section className="wrap section-block">
        <div className="section-heading"><div><span className="eyebrow">TEST LIBRARY</span><h2>今天测什么？</h2></div><span className="count-pill">{catalog.length} 套题</span></div>
        <div className="test-grid">
          {catalog.map((item, index) => <TestCard key={item.id} item={item} index={index} startTest={startTest} startAuto={startAuto} />)}
        </div>
      </section>

      <section className="wrap section-block history-section">
        <div className="section-heading"><div><span className="eyebrow">MY RESULTS</span><h2>测试记录</h2></div><span className="count-pill">{history.length} 条</span></div>
        {history.length ? (
          <div className="history-list">
            {history.map((item) => <HistoryRow key={item.id} item={item} open={() => openSaved(item)} remove={() => remove(item.id)} />)}
          </div>
        ) : <div className="empty-state"><span>♡</span><p>还没有结果，先选一套轻松玩玩吧。</p></div>}
      </section>
      <footer className="wrap footer">结果仅供娱乐 · API key 不会保存在浏览器记录中</footer>
    </main>
  );
}

function TestCard({ item, index, startTest, startAuto }) {
  const [locale, setLocale] = useState(item.languages[0]);
  const [variant, setVariant] = useState(item.variants?.[0]);
  return (
    <article className={`test-card ${item.color}`} style={{ "--delay": `${index * 70}ms` }}>
      <div className="card-top"><span className="card-number">0{index + 1}</span><span className="card-emoji">{item.emoji}</span></div>
      <div><h3>{item.title}</h3><p>{item.subtitle}</p></div>
      <div className="card-bottom">
        <span className="detail-pill">{item.detail}</span>
        {item.languages.length > 1 && (
          <div className="locale-switch" aria-label="题目语言">
            {item.languages.map((lang) => <button key={lang} className={locale === lang ? "active" : ""} onClick={() => setLocale(lang)}>{lang.toUpperCase()}</button>)}
          </div>
        )}
      </div>
      {item.variants && <div className="variant-switch"><span>题量</span>{item.variants.map((value) => <button key={value} className={variant === value ? "active" : ""} onClick={() => setVariant(value)}>{value} 题</button>)}</div>}
      <div className="card-actions">
        <button className="auto-action" onClick={() => startAuto(item, locale, variant)}>让 Jev 自动做题 <span>▶</span></button>
        <button className="manual-action" onClick={() => startTest(item, locale, null, variant)}>我来作答</button>
      </div>
    </article>
  );
}

function HistoryRow({ item, open, remove }) {
  const headline = resultHeadline(item);
  return (
    <article className="history-row">
      <button className="history-main" onClick={open}>
        <span className={`history-icon ${item.testId === "8values" ? "values" : item.testId}`}>{item.testId === "sbti" ? "S" : item.testId === "mbti" ? "16" : "8"}</span>
        <span><strong>{item.testTitle}</strong><small>{new Date(item.createdAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {localeName[item.locale]}</small></span>
        <b>{headline}</b><i>›</i>
      </button>
      <button className="delete-button" onClick={remove} aria-label="删除记录">×</button>
    </article>
  );
}

function Quiz({ session, setSession, choose, next, loading, goHome }) {
  const { test, answers, index } = session;
  const question = test.questions[index];
  const selected = answers[question.id];
  const progress = ((index + 1) / test.questions.length) * 100;
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [index]);
  return (
    <main className="quiz-page wrap-narrow">
      <div className="quiz-meta">
        <button className="round-button" onClick={goHome}>×</button>
        <div><strong>{test.title}</strong><span>{localeName[test.locale]}</span></div>
        <b>{String(index + 1).padStart(2, "0")}<small> / {test.questions.length}</small></b>
      </div>
      <div className="progress-track"><div style={{ width: `${progress}%` }} /></div>
      <section className="question-card" key={question.id}>
        <span className="question-kicker">凭第一感觉选</span>
        <h1>{question.text}</h1>
        <div className={`option-list options-${Math.min(question.options.length, 5)}`}>
          {question.options.map((option, optionIndex) => (
            <button
              key={`${question.id}-${optionIndex}`}
              className={Object.is(selected, option.value) ? "selected" : ""}
              onClick={() => choose(option.value)}
            >
              <span>{String.fromCharCode(65 + optionIndex)}</span><strong>{option.label}</strong><i>✓</i>
            </button>
          ))}
        </div>
      </section>
      <div className="quiz-actions">
        <button className="back-button" disabled={index === 0} onClick={() => setSession((current) => ({ ...current, index: current.index - 1 }))}>← 上一题</button>
        <button className="next-button" disabled={selected == null || loading} onClick={next}>{index === test.questions.length - 1 ? "生成结果 ✦" : "下一题 →"}</button>
      </div>
      <p className="source-line">题库来源：{test.source}</p>
    </main>
  );
}

function Result({ result, goHome }) {
  const headline = resultHeadline(result);
  return (
    <main className="result-page wrap-narrow">
      <section className={`result-hero ${result.testId === "8values" ? "values" : result.testId}`}>
        <span className="eyebrow light">YOUR RESULT · {localeName[result.locale]}</span>
        <h1>{headline}</h1>
        <p>{result.testTitle} · {new Date(result.createdAt).toLocaleDateString("zh-CN")}</p>
        <div className="result-sticker">✦</div>
      </section>

      <section className="result-panel">
        <div className="panel-title"><span>01</span><h2>{result.runMode === "auto" ? "Jev 的测试结果" : "标准计分"}</h2><b>{result.runMode === "auto" ? "AUTO" : "LOCAL"}</b></div>
        <StandardResult result={result.standard} />
      </section>

      <section className="result-panel">
        <div className="panel-title"><span>02</span><h2>{result.runMode === "auto" ? "逐题概率记录" : "Jev 概率结果"}</h2><b className="pink">LIVE</b></div>
        {result.runMode === "auto" ? <AutoRunResult run={result.jevRun} /> : result.jev ? <JevResult result={result} /> : (
          <div className="missing-result">
            <span>⌁</span><div><strong>{result.apiError ? "这次调用没有成功" : "这次没有使用 API"}</strong><p>{result.apiError || "填写 API key 后完成测试，即可看到概率与置信度。"}</p></div>
          </div>
        )}
      </section>

      <section className="result-note"><strong>小提醒</strong><p>{result.runMode === "auto" ? "这是 Jev 对整套题的自动选择结果；每次运行都独立调用，可用重复运行观察稳定性。" : "娱乐性测试，不用于心理诊断、招聘筛选或政治标签判断。标准计分由本地代码计算，Jev 结果来自语义概率判断，两者不同很正常。"}</p></section>
      <div className="result-actions"><button className="next-button" onClick={goHome}>再测一个</button><button className="back-button" onClick={() => navigator.clipboard?.writeText(`${result.testTitle}：${headline}`)}>复制结果</button></div>
      <p className="source-line">题库来源：{result.source}</p>
    </main>
  );
}

function StandardResult({ result }) {
  if (result.kind === "mbti") {
    const axes = [["E", "I"], ["S", "N"], ["T", "F"], ["J", "P"]];
    return <div className="axis-stack">{axes.map(([left, right]) => <Axis key={left} left={left} right={right} value={percentPair(result.scores[left], result.scores[right])} />)}</div>;
  }
  if (result.kind === "8values") {
    return <div className="axis-stack">
      <Axis left="平等" right="市场" value={result.values.econ} />
      <Axis left="世界" right="国家" value={result.values.dipl} />
      <Axis left="自由" right="权威" value={result.values.govt} />
      <Axis left="进步" right="传统" value={result.values.scty} />
    </div>;
  }
  return <div className="sbti-summary"><div className="sbti-name"><span>{result.primary.code}</span><strong>{result.primary.cn}</strong><small>匹配度 {result.primary.similarity}%</small></div><p>{result.primary.intro}</p><div className="top-matches">{result.rankings.slice(0, 4).map((item, index) => <span key={item.code}>#{index + 1} {item.code} {item.similarity}%</span>)}</div></div>;
}

function Axis({ left, right, value }) {
  return <div className="axis-row"><div><strong>{left}</strong><span>{Math.round(value)}%</span><span>{Math.round(100 - value)}%</span><strong>{right}</strong></div><div className="axis-track"><i style={{ width: `${value}%` }} /></div></div>;
}

function JevResult({ result }) {
  const answers = result.jev.answers;
  const choice = answers.type;
  const scores = Object.entries(answers).filter(([, answer]) => answer.type === "score");
  const scoreLabels = result.testId === "mbti" ? { ei: "外向 → 内向", sn: "实感 → 直觉", tf: "思考 → 情感", jp: "判断 → 知觉" } : result.testId === "8values" ? { econ: "平等 → 市场", dipl: "国家 → 世界", govt: "自由 → 权威", scty: "传统 → 进步" } : {};
  return <div>
    {choice && <div className="jev-choice"><div><span>首选</span><strong>{choice.choice}</strong><small>置信度 {Math.round(choice.confidence * 100)}%</small></div><div className="probability-list">{Object.entries(choice.probabilities).sort(([, a], [, b]) => b - a).slice(0, 4).map(([name, probability]) => <div key={name}><span>{name}</span><i><b style={{ width: `${probability * 100}%` }} /></i><em>{Math.round(probability * 100)}%</em></div>)}</div></div>}
    <div className="jev-score-grid">{scores.map(([key, answer]) => <div key={key}><span>{scoreLabels[key] || key.replace("model_", "").toUpperCase()}</span><strong>{answer.score.toFixed(2)}<small>/4</small></strong><i><b style={{ width: `${(answer.score / 4) * 100}%` }} /></i><em>置信度 {Math.round(answer.confidence * 100)}%</em></div>)}</div>
    <p className="model-line">{result.jev.model} · 输入 {result.jev.usage.input_tokens} tokens</p>
  </div>;
}

function AutoRunResult({ run }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? run.details : run.details.slice(0, 8);
  return <div className="auto-run-result">
    <div className="run-stats">
      <div><span>模型</span><strong>{run.model}</strong></div>
      <div><span>平均置信度</span><strong>{Math.round(run.averageConfidence * 100)}%</strong></div>
      <div><span>耗时</span><strong>{(run.elapsedMs / 1000).toFixed(1)}s</strong></div>
      <div><span>输入 Token</span><strong>{run.inputTokens}</strong></div>
    </div>
    <div className="answer-log">
      {shown.map((item, index) => <div key={String(item.questionId)}>
        <span>{String(index + 1).padStart(2, "0")}</span>
        <div><strong>{item.selectedLabel}</strong><small>{item.prompt}</small></div>
        <b>{Math.round(item.confidence * 100)}%</b>
      </div>)}
    </div>
    {run.details.length > 8 && <button className="log-toggle" onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : `查看全部 ${run.details.length} 题`}</button>}
  </div>;
}

function KeySheet({ value, onChange, onClose }) {
  const [draft, setDraft] = useState(value);
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="key-sheet"><button className="sheet-close" onClick={onClose}>×</button><span className="eyebrow">LIVE TEST</span><h2>连接你的 API</h2><p>仅保存在当前页面内存中。关闭或刷新页面后会清除，也不会写入测试记录。</p><label>TypeSafe API key<input type="password" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="ts_••••••••••••" /></label><button className="next-button" onClick={() => { onChange(draft.trim()); onClose(); }}>{draft.trim() ? "保存到当前页面" : "暂不使用 API"}</button><small>请求经本站同源服务端代理发送，key 不会进入前端日志或 localStorage。</small></section></div>;
}

function LoadingOverlay({ progress }) {
  const hasRun = progress?.total > 0;
  return <div className="loading-overlay"><div className="loader"><i /><i /><i /></div><strong>{progress ? "Jev 正在自动做题…" : "正在整理结果…"}</strong><span>{hasRun ? `已完成 ${progress.answered} / ${progress.total} · 第 ${progress.batch} / ${progress.batches} 批` : "概率正在落位"}</span>{hasRun && <div className="loading-progress"><i style={{ width: `${progress.answered / progress.total * 100}%` }} /></div>}</div>;
}

function resultHeadline(item) {
  const result = item.standard;
  if (result.kind === "mbti") return result.type;
  if (result.kind === "sbti") return `${result.primary.code} · ${result.primary.cn}`;
  const values = result.values;
  const dominant = [["平等", values.econ], ["世界", values.dipl], ["自由", values.govt], ["进步", values.scty]].sort((a, b) => b[1] - a[1])[0];
  return `${dominant[0]} ${Math.round(dominant[1])}%`;
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
