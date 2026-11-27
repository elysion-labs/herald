import { randomUUID } from 'node:crypto';

import type { LivePlatform } from '@herald/live';
import { liveTime } from '@herald/live-assistant/settings';
import { and, eq } from 'drizzle-orm';

import { platformLabels, platforms } from '../shared/platforms.ts';
import { schema } from './db/index.ts';
import type { Database } from './db/index.ts';
import type { openSessionIndex } from './session-index.ts';

const assistantLookback = 2 * 60 * 1000;

export function openLiveSessionIndex(db: Database, sessions: ReturnType<typeof openSessionIndex>) {
  const { conversations } = schema;

  /** 每个平台固定一个助手会话，缺失时创建（标题固定，不参与自动命名）。 */
  function ensureAssistants() {
    for (const platform of platforms) {
      if (!assistantConversation(platform)) {
        db.insert(conversations)
          .values({
            id: randomUUID(),
            platform,
            title: `${platformLabels[platform]}助手`,
            mode: 'assistant',
            createdAt: Date.now(),
            danmakuCursor: Date.now() - assistantLookback,
          })
          .run();
      }
    }
  }

  /** 开播：当前助手会话成为本场会话（开播前的准备内容随之保留）。 */
  function beginLiveSession(platform: LivePlatform) {
    ensureAssistants();
    const current = assistantConversation(platform);

    if (current && !current.liveStartedAt) {
      const now = Date.now();

      db.update(conversations)
        .set({ liveStartedAt: now, danmakuCursor: now - assistantLookback })
        .where(eq(conversations.id, current.id))
        .run();
    }

    return assistantConversation(platform);
  }

  /** 下播：本场会话转为普通会话，标题改为开播时间；再补上下一场的助手会话。 */
  function endLiveSession(platform: LivePlatform) {
    const current = assistantConversation(platform);

    if (!current?.liveStartedAt) {
      return undefined;
    }

    const title = `${liveTime(current.liveStartedAt)} 直播`;

    db.update(conversations)
      .set({ mode: 'chat', title })
      .where(eq(conversations.id, current.id))
      .run();
    sessions.store(current).open(current.id)?.appendSessionInfo(title);
    ensureAssistants();

    return sessions.conversation(current.id);
  }

  function assistantConversation(platform: LivePlatform) {
    return db
      .select()
      .from(conversations)
      .where(and(eq(conversations.platform, platform), eq(conversations.mode, 'assistant')))
      .get();
  }

  queueMicrotask(ensureAssistants);

  return { assistantConversation, beginLiveSession, endLiveSession };
}
