import { randomUUID } from 'node:crypto';

import { canRename, createSessionStore, readConversationHistory } from '@herald/agent';
import { ORPCError } from '@orpc/server';
import { and, desc, eq } from 'drizzle-orm';

import { schema } from './db/index.ts';
import type { Database } from './db/index.ts';

export type Conversation = typeof schema.conversations.$inferSelect;

export type ConversationMode = Conversation['mode'];

export function openSessionIndex(db: Database, directory: string, workspaceId: string) {
  const { conversations } = schema;
  const inWorkspace = eq(conversations.workspaceId, workspaceId);
  const byId = (id: string) => and(inWorkspace, eq(conversations.id, id));
  const store = createSessionStore(directory);

  const rename = (title: string, id: string) =>
    db.update(conversations).set({ title }).where(byId(id)).run();

  function getConversation(id: string) {
    const row = db.select().from(conversations).where(byId(id)).get();

    if (!row) {
      throw new ORPCError('NOT_FOUND', { message: '找不到会话' });
    }

    return row;
  }

  return {
    rename,
    conversation: getConversation,
    store,
    /** 新建普通会话，不区分平台。 */
    create() {
      const id = randomUUID();

      db.insert(conversations)
        .values({ id, workspaceId, title: '新会话', createdAt: Date.now() })
        .run();

      return getConversation(id);
    },
    list: () =>
      db
        .select()
        .from(conversations)
        .where(inWorkspace)
        .orderBy(desc(conversations.createdAt), desc(conversations.id))
        .all(),
    history(id: string) {
      const conversation = getConversation(id);
      const { title } = conversation;
      const session = store.open(id);
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
