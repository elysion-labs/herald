import { freshDanmaku } from '@herald/danmaku';
import type { DanmakuStore } from '@herald/danmaku';
import { eq } from 'drizzle-orm';

import { schema } from './db/index.ts';
import type { Database } from './db/index.ts';
import type { Conversation } from './session-index.ts';

const injectLimit = 30;

/** 助手模式：取游标之后的新弹幕（最多 30 条）并推进游标；普通模式返回 undefined。 */
export function takeDanmaku(db: Database, danmaku: DanmakuStore, conversation: Conversation) {
  if (conversation.mode !== 'assistant' || !conversation.platform) {
    return undefined;
  }

  const fresh = freshDanmaku(
    danmaku,
    conversation.platform,
    conversation.danmakuCursor,
    injectLimit,
  );

  if (fresh.cursor !== conversation.danmakuCursor) {
    db.update(schema.conversations)
      .set({ danmakuCursor: fresh.cursor })
      .where(eq(schema.conversations.id, conversation.id))
      .run();
  }

  return fresh;
}
