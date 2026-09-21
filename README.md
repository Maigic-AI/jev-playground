# Jev Playground

一个「只会做选择的 AI 实验室」：Jev 不生成文字，只输出选择、分数与概率。这里把它的概率判断做成一系列小实验。做题室已开放，游戏室企划中。

由 [Maigic](https://maigic.top) 出品 · GitHub：[@Maigic-AI](https://github.com/Maigic-AI)

## 站点结构

- `/` 主页：介绍 Jev Playground 的想法、Choice / Score / Noul 三种问题类型与各房间入口
- `/quiz` 做题室：选择题库后，Jev 自动逐题选择，题库原算法负责计算最终结果，并把每题概率与运行记录保存在当前浏览器中
- `/game` 游戏室：Jev 当游戏大脑的架构说明与排队中的实验企划（性格赛车、狼人杀、德州扑克）

前端为 React SPA，使用 History API 路由（无路由依赖），生产环境由 Express 提供 SPA fallback。

## 做题室功能

- SBTI：30 题、27 种娱乐性人格
- 16 型人格：40 题或 93 题，中英双语，可分别保存结果观察语言差异
- 8values：70 题，中英双语
- 一键让 Jev 自动完成整套题；大题库自动分批并行请求
- 保存每题选择、完整概率、置信度、耗时、模型版本与 token 用量
- 可以重复运行同一题库，或分别运行中英文题库观察差异
- 标准计分在浏览器本地完成
- 人工作答模式保留为可选对照
- 测试草稿和结果保存在 `localStorage`
- API key 仅保存在页面内存，通过同源 Node 代理发送，不进入本地记录
- 响应式手机界面

## 开发

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

打开 <http://127.0.0.1:5173>。

## 构建与生产运行

```bash
npm run build
npm start
```

生产服务默认监听 `127.0.0.1:5173`，可通过 `PORT` 修改端口。

## 部署到 Cloudflare

站点部署为 Cloudflare Workers + 静态资源（`wrangler.jsonc`）：`dist/` 由资源绑定直接下发（未命中的路由回落到 `index.html`，SPA 路由可用），`/api/system-one` 由 `worker/index.mjs` 处理，与本地 Express 服务共享 `shared/system-one.mjs` 中的校验与 TypeSafe SDK 调用逻辑。

```bash
npx wrangler login   # 首次需要，浏览器授权
npm run deploy       # 构建 + wrangler deploy
```

本地按 Worker 方式预览（端口 8787）：

```bash
npm run cf:dev
```

## 测试

```bash
npm test
npm run build
```

原有的命令行 Jev 样例仍然保留：

```bash
npm run test:api
npm run personality
npm run demo
```

## 许可证

本项目代码采用 [MIT License](./LICENSE) 开源。第三方题库的来源与许可证单独见 [THIRD_PARTY.md](./THIRD_PARTY.md)。

测试结果仅供娱乐，不是心理测量、医学诊断、招聘建议或政治身份判断。
