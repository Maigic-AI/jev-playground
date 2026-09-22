import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import PlaygroundHome from "./pages/playground.jsx";
import QuizFeature from "./pages/quiz.jsx";
import GameHome from "./pages/game.jsx";
import "./styles.css";

const routes = [
  { path: "/", label: "首页" },
  { path: "/quiz", label: "做题" },
  { path: "/game", label: "游戏" },
];

function normalize(pathname) {
  return pathname.replace(/\/+$/, "") || "/";
}

function App() {
  const [path, setPath] = useState(() => normalize(window.location.pathname));
  const [apiKey, setApiKey] = useState("");
  const [keyOpen, setKeyOpen] = useState(false);
  const [quizReset, setQuizReset] = useState(0);
  const [quota, setQuota] = useState(null);

  const refreshQuota = useCallback(() => {
    fetch("/api/quota", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((snapshot) => {
        if (snapshot) setQuota(snapshot);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshQuota();
  }, [refreshQuota]);

  // 每次使用默认 API 的请求都会在响应里带回最新配额快照。
  const applyQuota = useCallback((snapshot) => {
    setQuota({ available: true, ...snapshot });
  }, []);

  useEffect(() => {
    const onPopState = () => setPath(normalize(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!routes.some((route) => route.path === path)) {
      window.history.replaceState({}, "", "/");
      setPath("/");
    }
  }, [path]);

  function navigate(to) {
    if (to === path && to === "/quiz") setQuizReset((count) => count + 1);
    window.history.pushState({}, "", to);
    setPath(normalize(to));
    window.scrollTo({ top: 0 });
  }

  return (
    <div className="app-shell">
      <Header path={path} navigate={navigate} apiKey={apiKey} quota={quota} onKey={() => setKeyOpen(true)} />
      {path === "/" && <PlaygroundHome navigate={navigate} />}
      {path === "/quiz" && (
        <QuizFeature key={quizReset} apiKey={apiKey} onKey={() => setKeyOpen(true)} quota={quota} onQuota={applyQuota} />
      )}
      {path === "/game" && <GameHome navigate={navigate} />}
      <footer className="wrap footer">
        <p>Jev Playground · 娱乐性实验 · API key 仅保存在当前页面内存中</p>
        <p>
          © {new Date().getFullYear()} <a href="https://maigic.top" target="_blank" rel="noreferrer">Maigic 出品</a>
          {" · "}<a href="https://github.com/Maigic-AI" target="_blank" rel="noreferrer">GitHub</a>
          {" · "}MIT License
        </p>
      </footer>
      {keyOpen && (
        <KeySheet
          value={apiKey}
          quota={quota}
          onChange={setApiKey}
          onClose={() => {
            setKeyOpen(false);
            refreshQuota();
          }}
        />
      )}
    </div>
  );
}

function Header({ path, navigate, apiKey, quota, onKey }) {
  const connected = Boolean(apiKey) || (quota?.available && quota.remaining > 0);
  const label = apiKey
    ? "API 已就绪"
    : quota?.available
      ? (quota.remaining > 0 ? `默认 API · 剩余 ${quota.remaining} 次` : "默认 API · 今日用完")
      : "填写 API";
  return (
    <header className="topbar">
      <button className="brand" onClick={() => navigate("/")} aria-label="返回首页">
        <span className="brand-mark">J</span><span>Jev Playground</span>
      </button>
      <div className="topbar-actions">
        <nav className="site-nav" aria-label="站内导航">
          {routes.map((route) => (
            <button
              key={route.path}
              className={path === route.path ? "active" : ""}
              aria-current={path === route.path ? "page" : undefined}
              onClick={() => navigate(route.path)}
            >
              {route.label}
            </button>
          ))}
        </nav>
        <button className={`key-button ${connected ? "connected" : ""}`} onClick={onKey}>
          <span className="status-dot" />{label}
        </button>
      </div>
    </header>
  );
}

function KeySheet({ value, quota, onChange, onClose }) {
  const [draft, setDraft] = useState(value);
  const save = () => {
    onChange(draft.trim());
    onClose();
  };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="key-sheet"><button className="sheet-close" onClick={onClose}>×</button><span className="eyebrow">LIVE TEST</span><h2>连接你的 API</h2>{quota?.available ? <p className="sheet-quota">本站已配置共享默认 API：今日剩余 <strong>{quota.remaining}</strong> / {quota.limit} 次（全站共享，北京时间每日 0 点重置），不填 key 可直接使用。</p> : <p className="sheet-quota">本站暂未配置默认 API，请填写你自己的 key。</p>}<p>自己的 key 仅保存在当前页面内存中。关闭或刷新页面后会清除，也不会写入测试记录，且不受默认 API 每日配额限制。</p><label>TypeSafe API key<input type="password" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="ts_••••••••••••" /></label><button className="next-button" onClick={save}>{draft.trim() ? "保存到当前页面" : (quota?.available ? "使用默认 API" : "暂不使用 API")}</button><small>请求经本站同源服务端代理发送，key 不会进入前端日志或 localStorage。</small></section></div>;
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
