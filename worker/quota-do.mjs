import { DurableObject } from "cloudflare:workers";
import { quotaDay, quotaResetAt } from "../shared/quota-day.mjs";

// 每日配额计数器（SQLite-backed Durable Object，Workers 免费计划可用）。
// 全局单例：worker/index.mjs 通过 env.QUOTA.idFromName("global") 获取。
// limit 由调用方按次传入（来自 JEV_DAILY_LIMIT 变量），改限额无需迁移存储状态。
// 继承 DurableObject 基类以支持 JSRPC（可直接在 stub 上调用方法）。

export class QuotaCounter extends DurableObject {
  #ready;

  constructor(ctx, env) {
    super(ctx, env); // 基类提供 this.ctx / this.env
    this.#ready = ctx.blockConcurrencyWhile(() =>
      ctx.storage.sql
        .exec("CREATE TABLE IF NOT EXISTS usage (day TEXT PRIMARY KEY, used INTEGER NOT NULL)")
        .toArray()
    );
  }

  async #snapshotFor(day, limit) {
    const rows = this.ctx.storage.sql.exec("SELECT used FROM usage WHERE day = ?1", day).toArray();
    const used = Math.min(rows[0]?.used ?? 0, limit);
    return { limit, used, remaining: Math.max(0, limit - used), resetAt: quotaResetAt(day) };
  }

  /** 当前配额视图。 */
  async snapshot(limit) {
    await this.#ready;
    return this.#snapshotFor(quotaDay(), limit);
  }

  /** 原子预占：单条 upsert，额度不足时不产生行、RETURNING 为空 => ok:false。SQLite 串行化保证绝不超限。 */
  async tryReserve(limit) {
    await this.#ready;
    const day = quotaDay();
    if (limit < 1) return { ok: false, day, snapshot: await this.#snapshotFor(day, limit) };
    const rows = this.ctx.storage.sql
      .exec(
        `INSERT INTO usage (day, used) VALUES (?1, 1)
         ON CONFLICT (day) DO UPDATE SET used = usage.used + 1 WHERE usage.used < ?2
         RETURNING used`,
        day,
        limit
      )
      .toArray();
    // 注意：#snapshotFor 是 async 方法，必须在返回前 await，否则 RPC 无法克隆嵌套的 Promise。
    return { ok: rows.length === 1, day, snapshot: await this.#snapshotFor(day, limit) };
  }

  /** 释放预占（按预占时的日期回退，跨天调用不会污染新的一天）。 */
  async release(day) {
    await this.#ready;
    this.ctx.storage.sql.exec("UPDATE usage SET used = used - 1 WHERE day = ?1 AND used > 0", day);
  }
}
