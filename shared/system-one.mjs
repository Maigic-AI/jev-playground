import { TypeSafeClient } from "@typesafe-ai/sdk";

// 共享的 /api/system-one 处理逻辑：本地 Express 服务与 Cloudflare Worker 复用。
// 输入请求体，输出 { status, payload }，不直接接触任何运行时专属 API。

const fail = (status, error) => ({ status, payload: { error } });

/** 请求体校验：通过返回 null，否则返回 { status, error }。供策略模块在预占配额前先校验。 */
export function validateSystemOneBody(requestBody) {
  const { apiKey, state, questions } = requestBody ?? {};
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return { status: 400, error: "请先填写 TypeSafe API key。" };
  }
  if (!state || !questions || typeof questions !== "object") {
    return { status: 400, error: "测试数据不完整。" };
  }
  const entries = Object.entries(questions);
  if (entries.length < 1 || entries.length > 40) {
    return { status: 400, error: "问题数量必须在 1 到 40 之间。" };
  }
  for (const [, question] of entries) {
    if (!question || !["choice", "score", "noul"].includes(question.type)) {
      return { status: 400, error: "包含不支持的问题类型。" };
    }
  }
  return null;
}

export async function handleSystemOne(requestBody) {
  const { apiKey, state, questions, model = "jev-latest" } = requestBody ?? {};
  const invalid = validateSystemOneBody(requestBody);
  if (invalid) {
    return fail(invalid.status, invalid.error);
  }

  try {
    const client = new TypeSafeClient({ apiKey: apiKey.trim(), timeout: 30_000 });
    const result = await client.systemOne({ model, state, questions });
    return { status: 200, payload: result };
  } catch (error) {
    const status = Number(error?.status) || 502;
    const safeStatus = status >= 400 && status < 600 ? status : 502;
    return {
      status: safeStatus,
      payload: { error: error?.message || "TypeSafe 请求失败，请稍后重试。" },
    };
  }
}
