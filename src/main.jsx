import React, { useEffect, useState } from "react";
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
      <Header path={path} navigate={navigate} apiKey={apiKey} onKey={() => setKeyOpen(true)} />
      {path === "/" && <PlaygroundHome navigate={navigate} />}
      {path === "/quiz" && <QuizFeature key={quizReset} apiKey={apiKey} onKey={() => setKeyOpen(true)} />}
      {path === "/game" && <GameHome navigate={navigate} />}
      <footer className="wrap footer">
        <p>Jev Playground · 娱乐性实验 · API key 仅保存在当前页面内存中</p>
        <p>
          © {new Date().getFullYear()} <a href="https://maigic.top" target="_blank" rel="noreferrer">Maigic 出品</a>
          {" · "}<a href="https://github.com/Maigic-AI" target="_blank" rel="noreferrer">GitHub</a>
          {" · "}MIT License
        </p>
      </footer>
      {keyOpen && <KeySheet value={apiKey} onChange={setApiKey} onClose={() => setKeyOpen(false)} />}
    </div>
  );
}

function Header({ path, navigate, apiKey, onKey }) {
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
        <button className={`key-button ${apiKey ? "connected" : ""}`} onClick={onKey}>
          <span className="status-dot" />{apiKey ? "API 已就绪" : "填写 API"}
        </button>
      </div>
    </header>
  );
}

function KeySheet({ value, onChange, onClose }) {
  const [draft, setDraft] = useState(value);
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="key-sheet"><button className="sheet-close" onClick={onClose}>×</button><span className="eyebrow">LIVE TEST</span><h2>连接你的 API</h2><p>仅保存在当前页面内存中。关闭或刷新页面后会清除，也不会写入测试记录。</p><label>TypeSafe API key<input type="password" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="ts_••••••••••••" /></label><button className="next-button" onClick={() => { onChange(draft.trim()); onClose(); }}>{draft.trim() ? "保存到当前页面" : "暂不使用 API"}</button><small>请求经本站同源服务端代理发送，key 不会进入前端日志或 localStorage。</small></section></div>;
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
