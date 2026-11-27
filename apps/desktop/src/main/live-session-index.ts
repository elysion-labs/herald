import { randomUUID } from 'node:crypto';

import type { DanmakuStore } from '@herald/danmaku';
import type { LivePlatform } from '@herald/live';
import { liveTime } from '@herald/live-assistant/settings';
import { and, eq } from 'drizzle-orm';

import { schema } from './db/index.ts';
import type { Database } from './db/index.ts';
import type { openSessionIndex } from './session-index.ts';

const assistantLookback = 2 * 60 * 1000;

export function openLiveSessionIndex(
  db: Database,
  workspaceId: string,
  sessions: ReturnType<typeof openSessionIndex>,
  danmaku: DanmakuStore,
) {
  const { conversations } = schema;
  const inWorkspace = eq(conversations.workspaceId, workspaceId);
  const assistantOnly = and(inWorkspace, eq(conversations.mode, 'assistant'));

  function assistantConversation() {
    return db.select().from(conversations).where(assistantOnly).get();
  }

  function ensureAssistant(cursor: number) {
    if (!assistantConversation()) {
      db.insert(conversations)
        .values({
          id: randomUUID(),
          workspaceId,
          title: '直播助手',
          mode: 'assistant',
          createdAt: Date.now(),
          danmakuCursor: cursor,
        })
        .run();
    }
  }

  function beginLiveSession(platforms: LivePlatform[]) {
    const now = Date.now();
    db.update(conversations)
      .set({
        liveStartedAt: now,
        livePlatforms: platforms,
        danmakuCursor: danmaku.before(now - assistantLookback),
      })
      .where(assistantOnly)
      .run();

    return assistantConversation();
  }

  function endLiveSession() {
    const current = assistantConversation();

    if (!current?.liveStartedAt) {
      return undefined;
    }

    const title = `${liveTime(current.liveStartedAt)} 直播`;
    const cursor = danmaku.before(Date.now() - assistantLookback);

    db.transaction(() => {
      db.update(conversations)
        .set({ mode: 'chat', title })
        .where(and(inWorkspace, eq(conversations.id, current.id)))
        .run();
      ensureAssistant(cursor);
    });

    sessions.store.open(current.id)?.appendSessionInfo(title);

    return sessions.conversation(current.id);
  }

  const initialCursor = danmaku.before(Date.now() - assistantLookback);
  ensureAssistant(initialCursor);

  return { assistantConversation, beginLiveSession, endLiveSession };
}
