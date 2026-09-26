// 笔仙纸面 A 边条布局（spec 定案）与脚本答案类别字表 —— 纯逻辑，无 DOM。
// 逻辑坐标 100×160 与漂移引擎同一坐标系；字位公式与引擎入库时的测试夹具逐位相同，
// 落定矩阵的耗时窗口（沉稳≈7.6s 等）因此无需重校准。

// 顶边勾-是-否-叉，左右列一~五/六~十，底边男唐宋元明清女（21 字/符号）
export const CELLS = [
  { key: "勾", label: "勾", x: 14, y: 13 },
  { key: "是", label: "是", x: 37, y: 13 },
  { key: "否", label: "否", x: 63, y: 13 },
  { key: "叉", label: "叉", x: 86, y: 13 },
  ..."一二三四五".split("").map((ch, i) => ({ key: ch, label: ch, x: 12, y: 42 + i * 22.5 })),
  ..."六七八九十".split("").map((ch, i) => ({ key: ch, label: ch, x: 88, y: 42 + i * 22.5 })),
  ...["男", "唐", "宋", "元", "明", "清", "女"].map((ch, i) => ({ key: ch, label: ch, x: 12 + i * 12.67, y: 147 })),
];

export const cellByKey = (key) => CELLS.find((cell) => cell.key === key) || null;

// 验笔为仪式脚本：固定一问「你是笔仙吗」，笔落『勾』即仙至（不耗灵力、不走回答器）
export const VERIFY_CELL = cellByKey("勾");

// 答案类别字表（CONTEXT.md）：是否、一至十、唐宋元明清、男女；
// 勾/叉是验笔的确认符号，不入答案类别（问询裁决的落定字表见 bixian-responder 的 GLYPHS）
export const ANSWER_CELLS = CELLS.filter((cell) => cell.key !== "勾" && cell.key !== "叉");
