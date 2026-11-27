import { randomUUID } from 'node:crypto';

import { canRename, createSessionStore, readConversationHistory } from '@herald/agent';
import { ORPCError } from '@orpc/server';
import { desc, eq } from 'drizzle-orm';

import { schema } from './db/index.ts';
import type { Database } from './db/index.ts';

export type Conversation = typeof schema.conversations.$inferSelect;

export type ConversationMode = Conversation['mode'];

export function openSessionIndex(db: Database, directory: string) {
  const { conversations } = schema;

  const rename = (title: string, id: string) =>
    db.update(conversations).set({ title }).where(eq(conversations.id, id)).run();

  function getConversation(id: string) {
    const row = db.select().from(conversations).where(eq(conversations.id, id)).get();

    if (!row) {
      throw new ORPCError('NOT_FOUND', { message: '找不到会话' });
    }

    return row;
  }

  const store = (conversation: Pick<Conversation, 'platform'>) =>
    createSessionStore(directory, conversation.platform ?? 'chat');

  return {
    rename,
    conversation: getConversation,
    store,
    /** 新建普通会话，不区分平台。 */
    create() {
      const id = randomUUID();

      db.insert(conversations)
        .values({ id, platform: null, title: '新会话', createdAt: Date.now() })
        .run();

      return getConversation(id);
    },
    list: () =>
      db
        .select()
        .from(conversations)
        .orderBy(desc(conversations.createdAt), desc(conversations.id))
        .all(),
    history(id: string) {
      const conversation = getConversation(id);
      const { title } = conversation;
      const session = store(conversation).open(id);
      const name = session?.getSessionName();

      // 标题以 session jsonl 为准，列表索引不一致时以它恢复。
      if (canRename(conversation) && name && name !== title) {
        rename(name, id);
      }

      const entries = session?.getBranch() ?? [];

      return readConversationHistory(entries);
    },
  };
}
