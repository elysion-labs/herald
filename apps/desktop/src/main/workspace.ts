import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { createConversationRuntime } from '@herald/agent';
import type { AgentTools } from '@herald/agent';
import { openDanmakuStore } from '@herald/danmaku';
import { openMemoryLibrary } from '@herald/memory-tool';

import type { Attachment } from '../shared/attachments.ts';
import type { ChatModelChoice } from '../shared/model-settings.ts';
import { platforms } from '../shared/platforms.ts';
import { openAppSettings } from './app-settings.ts';
import { prepareConversationInput } from './conversation-input.ts';
import { takeDanmaku } from './danmaku-cursor.ts';
import { openDatabase } from './db/index.ts';
import { openLiveRooms } from './live-rooms.ts';
import { openLiveSessionIndex } from './live-session-index.ts';
import { openModelSettings } from './model-settings.ts';
import { openSessionIndex } from './session-index.ts';

export type { ConversationMode } from './session-index.ts';

export function openWorkspace(directory: string) {
  mkdirSync(directory, { recursive: true });
  mkdirSync(join(directory, 'agent'), { recursive: true });
  const db = openDatabase(directory);
  const models = openModelSettings(db, directory);
  const settings = openAppSettings(db, directory);
  const memory = openMemoryLibrary(join(directory, 'memory'));
  const rooms = openLiveRooms(db);
  const danmaku = openDanmakuStore(db);
  rooms.onMessage(message => danmaku.add(message));

  const sessions = openSessionIndex(db, directory);
  const liveSessions = openLiveSessionIndex(db, sessions);

  const runtime = createConversationRuntime({
    store: sessions.store,
    conversation: sessions.conversation,
    rename: sessions.rename,
    currentModel: id => models.current(id),
    agentSettings: settings.agent,
    memory,
    danmaku,
    platforms,
    room: platform => rooms.status(platform) ?? undefined,
    takeDanmaku: id => takeDanmaku(db, danmaku, sessions.conversation(id)),
  });

  return {
    models,
    memory,
    rooms,
    danmaku,
    settings,
    ...sessions,
    ...liveSessions,
    ...runtime,
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
  };
}
