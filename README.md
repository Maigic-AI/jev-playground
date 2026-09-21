# Jev Pop Lab

一个移动端优先的 Jev 自动跑测站：选择题库后，Jev 会自动逐题选择，题库原算法负责计算最终结果，并把每题概率与运行记录保存在当前浏览器中。

## 功能

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

题库来源和许可证见 [THIRD_PARTY.md](./THIRD_PARTY.md)。测试结果仅供娱乐，不是心理测量、医学诊断、招聘建议或政治身份判断。
