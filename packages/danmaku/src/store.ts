import type { LivePlatform } from '@herald/live';
import { and, count, desc, eq, gt, gte, lt, lte, or, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import * as schema from './schema.ts';

/** 任意同步 SQLite drizzle 实例（例如 drizzle-orm/node-sqlite）。 */
export type DanmakuDatabase = BaseSQLiteDatabase<'sync', any, any, any>;

/** 写入一条弹幕需要的字段；evidenceId 供记忆核验引用。 */
export interface DanmakuMessage {
  evidenceId: string;
  platform: LivePlatform;
  roomId: string;
  authorId: string | null;
  authorName: string | null;
  text: string;
  receivedAt: number;
}

const flushDelay = 1000;
const retention = 30 * 24 * 60 * 60 * 1000;

export type StoredDanmaku = typeof schema.danmaku.$inferSelect;

export interface DanmakuQuery {
  platform: LivePlatform;
  since?: number;
  until?: number;
  /** 观众 UID 或昵称（昵称模糊匹配）。 */
  viewer?: string;
  keyword?: string;
  limit?: number;
}

function escapeLike(value: string) {
  return value.replaceAll(/[\\%_]/g, character => `\\${character}`);
}

/**
 * 弹幕持久化：收到的弹幕先进缓冲区，每秒用一个事务批量写入，保留 30 天。
 * 查询前会先落盘缓冲区，保证刚到的弹幕也能查到。
 */
export function openDanmakuStore(db: DanmakuDatabase) {
  const { danmaku } = schema;
  let buffer: StoredDanmaku[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush() {
    timer = undefined;

    if (!buffer.length) {
      return;
    }

    const rows = buffer;
    buffer = [];
    db.transaction(() => {
      db.insert(danmaku).values(rows).onConflictDoNothing().run();
    });
  }

  function filters({ platform, since, until, viewer, keyword }: DanmakuQuery) {
    const name = viewer && `%${escapeLike(viewer)}%`;

    return and(
      eq(danmaku.platform, platform),
      since === undefined ? undefined : gte(danmaku.receivedAt, since),
      until === undefined ? undefined : lte(danmaku.receivedAt, until),
      name
        ? or(eq(danmaku.authorId, viewer), sql`${danmaku.authorName} LIKE ${name} ESCAPE '\\'`)
        : undefined,
      keyword ? sql`${danmaku.text} LIKE ${`%${escapeLike(keyword)}%`} ESCAPE '\\'` : undefined,
    );
  }

  db.delete(danmaku)
    .where(lt(danmaku.receivedAt, Date.now() - retention))
    .run();

  return {
    add(message: DanmakuMessage) {
      buffer.push({
        evidenceId: message.evidenceId,
        platform: message.platform,
        roomId: message.roomId,
        authorId: message.authorId,
        authorName: message.authorName,
        text: message.text,
        receivedAt: message.receivedAt,
      });
      timer ??= setTimeout(flush, flushDelay);
    },
    /** 按 evidence_id 找一条弹幕，用于核验观众记忆的来源。 */
    find(evidenceId: string) {
      return (
        buffer.find(row => row.evidenceId === evidenceId) ??
        db.select().from(danmaku).where(eq(danmaku.evidenceId, evidenceId)).get()
      );
    },
    /** 按条件查询，结果按时间正序返回最近的 limit 条。 */
    query(input: DanmakuQuery) {
      flush();

      return db
        .select()
        .from(danmaku)
        .where(filters(input))
        .orderBy(desc(danmaku.receivedAt))
        .limit(Math.min(input.limit ?? 50, 200))
        .all()
        .reverse();
    },
    /** 发言最多的观众。 */
    viewers(input: DanmakuQuery) {
      flush();
      const total = count();

      return db
        .select({ viewerId: danmaku.authorId, viewerName: danmaku.authorName, count: total })
        .from(danmaku)
        .where(filters(input))
        .groupBy(danmaku.authorId)
        .orderBy(desc(total))
        .limit(Math.min(input.limit ?? 20, 100))
        .all();
    },
    /** 每分钟弹幕量，按时间正序。 */
    timeline(input: DanmakuQuery) {
      flush();
      const minute = sql<number>`(${danmaku.receivedAt} / 60000) * 60000`;

      return db
        .select({ minute, count: count() })
        .from(danmaku)
        .where(filters(input))
        .groupBy(minute)
        .orderBy(desc(minute))
        .limit(Math.min(input.limit ?? 60, 240))
        .all()
        .reverse();
    },
    /** 游标之后的新弹幕（助手模式增量注入用）。 */
    after(platform: LivePlatform, cursor: number, limit: number) {
      flush();
      const where = and(eq(danmaku.platform, platform), gt(danmaku.receivedAt, cursor));
      const total = db.select({ count: count() }).from(danmaku).where(where).get()?.count ?? 0;

      const rows = db
        .select()
        .from(danmaku)
        .where(where)
        .orderBy(desc(danmaku.receivedAt))
        .limit(limit)
        .all()
        .reverse();

      return { rows, skipped: Math.max(0, total - rows.length) };
    },
    flush,
    dispose() {
      if (timer) {
        clearTimeout(timer);
      }

      flush();
    },
  };
}

export type DanmakuStore = ReturnType<typeof openDanmakuStore>;
