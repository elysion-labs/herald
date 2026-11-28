import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { createConversationRuntime } from '@herald/agent';
import type { AgentTools } from '@herald/agent';
import { openDanmakuStore } from '@herald/danmaku';
import { assistantSettings } from '@herald/live-assistant/settings';
import type { AssistantSettings } from '@herald/live-assistant/settings';
import { openMemoryLibrary } from '@herald/memory-tool';
import { eq } from 'drizzle-orm';

import type { Attachment } from '../shared/attachments.ts';
import type { ChatModelChoice } from '../shared/model-settings.ts';
import type { openAppSettings } from './app-settings.ts';
import { prepareConversationInput } from './conversation-input.ts';
import { takeDanmaku } from './danmaku-cursor.ts';
import { schema } from './db/index.ts';
import type { Database } from './db/index.ts';
import { openLiveRooms } from './live-rooms.ts';
import { openLiveSessionIndex } from './live-session-index.ts';
import type { openModelSettings } from './model-settings.ts';
import { openSessionIndex } from './session-index.ts';

export type { ConversationMode } from './session-index.ts';

interface WorkspaceOptions {
  db: Database;
  id: string;
  directory: string;
  agentDir: string;
  settings: ReturnType<typeof openAppSettings>;
  models: ReturnType<typeof openModelSettings>;
}

export function openWorkspace({ db, id, directory, agentDir, settings, models }: WorkspaceOptions) {
  mkdirSync(directory, { recursive: true });
  const memory = openMemoryLibrary(join(directory, 'memory'));
  const rooms = openLiveRooms(db, id);
  const danmaku = openDanmakuStore(db, id);
  const unsubscribe = rooms.onMessage(message => danmaku.add(message));
  const { workspaces } = schema;

  const sessions = openSessionIndex(db, directory, id);
  const liveSessions = openLiveSessionIndex(db, id, sessions, danmaku);

  const runtime = createConversationRuntime({
    store: sessions.store,
    agentDir,
    conversation: sessions.conversation,
    rename: sessions.rename,
    currentModel: conversationId => models.current(conversationId),
    agentSettings: settings.agent,
    memory,
    danmaku,
    platforms: rooms.boundPlatforms,
    room: platform => rooms.status(platform) ?? undefined,
    takeDanmaku: conversationId =>
      takeDanmaku(db, danmaku, sessions.conversation(conversationId), rooms.boundPlatforms()),
  });

  function getAssistantSettings() {
    return assistantSettings.parse(
      db
        .select({ assistant: workspaces.assistant })
        .from(workspaces)
        .where(eq(workspaces.id, id))
        .get()?.assistant,
    );
  }

  return {
    id,
    memory,
    rooms,
    danmaku,
    ...sessions,
    ...liveSessions,
    ...runtime,
    getAssistantSettings,
    saveAssistantSettings(input: Partial<AssistantSettings>) {
      const assistant = assistantSettings.parse({ ...getAssistantSettings(), ...input });
      db.update(workspaces).set({ assistant }).where(eq(workspaces.id, id)).run();

      return assistant;
    },
    list() {
      const bound = rooms.boundPlatforms();

      return sessions
        .list()
        .map(row =>
          row.mode === 'assistant' && !row.liveStartedAt ? { ...row, livePlatforms: bound } : row,
        );
    },
    setModelChoice(id: string, choice: ChatModelChoice) {
      sessions.conversation(id);

      return models.saveChoice(id, choice);
    },
    send(
      id: string,
      { text, attachments }: { text: string; attachments: readonly Attachment[] },
      tools: AgentTools,
      publish: Parameters<typeof runtime.send>[3],
    ) {
      sessions.conversation(id);

      return runtime.send(id, prepareConversationInput(text, attachments), tools, publish);
    },
    dispose() {
      unsubscribe();
      rooms.stop();
      danmaku.dispose();
      void memory.dispose().catch((error: unknown) => console.warn('关闭记忆索引失败', error));
    },
  };
}
