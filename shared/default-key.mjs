import { handleSystemOne, validateSystemOneBody } from "./system-one.mjs";

// /api/system-one 的代理策略：本地 Express 服务与 Cloudflare Worker 复用。
// 访客未自带 API key 时改用站方共享的默认 key（服务端注入，绝不回传给浏览器），
// 并施加每日全站共享的调用配额；自带 key 的请求原样透传，不占配额。

const QUOTA_EXHAUSTED_ERROR =
  "今日默认 API 调用次数已用完（全站每日共享额度有限，北京时间每天 0 点重置）。填写你自己的 API key 可以立即继续使用。";

/**
 * deps:
 *  - defaultKey: string | null        站方共享 key（运行时从 secret/env 注入）
 *  - quota: { snapshot(), tryReserve(), release(reservation) }
 *  - callUpstream = handleSystemOne   可注入以便单测
 * 返回 { status, payload }，payload 内可含 quota: { limit, used, remaining, resetAt }。
 */
export async function handleProxyRequest(body, deps) {
  const { defaultKey, quota, callUpstream = handleSystemOne } = deps ?? {};
  const ownKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";

  // 1) 访客自带 key：原样透传，不占配额。
  if (ownKey) return callUpstream(body);

  // 2) 站方未配置默认 key：保持原有行为。
  if (!defaultKey) return { status: 400, payload: { error: "请先填写 TypeSafe API key。" } };

  // 3) 先校验请求体，坏请求不占配额（apiKey 由服务端补上再校验）。
  const invalid = validateSystemOneBody({ ...body, apiKey: defaultKey });
  if (invalid) return { status: invalid.status, payload: { error: invalid.error } };

  // 4) 原子预占一个名额；额度不足则 429。
  const reservation = await quota.tryReserve();
  if (!reservation.ok) {
    return { status: 429, payload: { error: QUOTA_EXHAUSTED_ERROR, quota: reservation.snapshot } };
  }

  // 5) 用服务端 key 调上游；非 200 或抛错都释放名额（只有成功调用才计数）。
  let result;
  try {
    result = await callUpstream({ ...body, apiKey: defaultKey });
  } catch (error) {
    await quota.release(reservation);
    throw error;
  }
  if (result.status !== 200) {
    await quota.release(reservation);
    return result;
  }

  // 6) 成功：附加最新配额快照（仅数字与时间戳，不含任何 key 信息）。
  return { status: 200, payload: { ...result.payload, quota: await quota.snapshot() } };
}
