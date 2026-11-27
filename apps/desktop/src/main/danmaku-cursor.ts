import { freshDanmaku } from '@herald/danmaku';
import type { DanmakuStore } from '@herald/danmaku';
import type { LivePlatform } from '@herald/live';
import { and, eq } from 'drizzle-orm';

import { schema } from './db/index.ts';
import type { Database } from './db/index.ts';
import type { Conversation } from './session-index.ts';

const injectLimit = 30;

/** 助手模式：取游标之后的新弹幕（最多 30 条）并推进游标；普通模式返回 undefined。 */
export function takeDanmaku(
  db: Database,
  danmaku: DanmakuStore,
  conversation: Conversation,
  platforms: readonly LivePlatform[],
) {
  if (conversation.mode !== 'assistant') {
    return undefined;
  }

  const fresh = freshDanmaku(danmaku, platforms, conversation.danmakuCursor, injectLimit);

  if (fresh.cursor !== conversation.danmakuCursor) {
    db.update(schema.conversations)
      .set({ danmakuCursor: fresh.cursor })
      .where(
        and(
          eq(schema.conversations.workspaceId, conversation.workspaceId),
          eq(schema.conversations.id, conversation.id),
        ),
      )
      .run();
  }

  return fresh;
}
