import { randomUUID } from 'node:crypto';
import { EventEmitter, on } from 'node:events';

import { createBrowserAgentTools } from '@herald/browser-tool';
import { fetchRoomProfile } from '@herald/live';
import { createLiveAssistant } from '@herald/live-assistant';
import { assistantSettings } from '@herald/live-assistant/settings';
import { os } from '@orpc/server';
import { z } from 'zod';

import { agentSettings } from '../shared/agent-settings.ts';
import { attachment, maxAttachments } from '../shared/attachments.ts';
import {
  chatModelChoice,
  customProviderInput,
  modelDiscovery,
  presetKeyInput,
} from '../shared/model-settings.ts';
import { platforms } from '../shared/platforms.ts';
import type { createWorkspaceBrowser } from './browser.ts';
import { createLiveSessions } from './live-sessions.ts';
import { getPlatformAccount, readLiveCookies } from './platform-accounts.ts';
import type { openWorkspace } from './workspace.ts';

const platform = z.enum(platforms);
const coordinate = z.number().int().min(0).max(16384);
const dimension = coordinate.min(1);
const viewerId = z.string().trim().min(1).max(128);
const memoryScope = z.enum(['shared', ...platforms]);
const memoryRecord = z.object({ scope: memoryScope, id: z.uuid() });

const manualMemory = z
  .object({
    scope: memoryScope,
    viewerId: viewerId.optional(),
    fact: z.string().trim().min(1).max(500),
    quote: z.string().trim().min(1).max(1000),
  })
  .refine(
    input => (input.scope === 'shared') === !input.viewerId,
    '请选择与观众 UID 匹配的归档范围',
  );

type ReplyTurns = Parameters<Parameters<ReturnType<typeof openWorkspace>['remind']>[3]>[0];

export function createRouter(
  workspace: ReturnType<typeof openWorkspace>,
  browser: ReturnType<typeof createWorkspaceBrowser>,
) {
  const browserTools = createBrowserAgentTools({ webContents: browser.webContents });

  /** agent 运行期间新开的标签页，在运行结束后关闭。 */
  async function closingAgentTabs<T>(run: () => Promise<T>) {
    const before = browser.agentTabs();

    try {
      return await run();
    } finally {
      for (const id of browser.agentTabs()) {
        if (!before.has(id)) {
          browser.close(id);
        }
      }
    }
  }

  const assistant = createLiveAssistant({
    assistantConversation: platform => workspace.assistantConversation(platform)?.id,
    isRunning: id => workspace.isRunning(id),
    remind: (id, trigger, publish: (turns: ReplyTurns) => void) =>
      closingAgentTabs(() => workspace.remind(id, trigger, browserTools, publish)),
    settings: () => workspace.settings.assistant(),
    viewerFacts: (platform, viewerId) =>
      workspace.memory
        .list(platform)
        .filter(record => record.viewerId === viewerId)
        .map(record => record.fact),
    roomConnected: platform => workspace.rooms.status(platform)?.state === 'connected',
    roomLive: platform => workspace.rooms.status(platform)?.live ?? 'unknown',
    onMessage: listener => workspace.rooms.onMessage(listener),
  });

  const liveSessions = createLiveSessions(workspace, assistant);

  return {
    platforms: {
      account: os.input(platform).handler(({ input, signal }) => getPlatformAccount(input, signal)),
    },
    rooms: {
      status: os.input(platform).handler(({ input }) => workspace.rooms.status(input)),
      watch: os
        .input(platform)
        .handler(({ input, signal }) => workspace.rooms.watch(input, signal)),
      /** 当前绑定直播间的主播资料（平台接口）。 */
      profile: os.input(platform).handler(async ({ input, signal }) => {
        const room = workspace.rooms.status(input);

        if (!room) {
          return null;
        }

        const cookie = await readLiveCookies(input, signal ?? new AbortController().signal).catch(
          () => null,
        );

        return fetchRoomProfile(input, room.roomId, { cookie, signal });
      }),
      reconnect: os.input(platform).handler(({ input }) => {
        workspace.rooms.connect(input);

        return workspace.rooms.status(input);
      }),
      setBinding: os
        .input(z.object({ platform, room: z.string().trim().min(1).max(512).nullable() }))
        .handler(({ input }) => {
          // 换绑到另一个直播间时，结束当前场次（会先复盘）。
          const previous = workspace.rooms.status(input.platform)?.roomId;
          const room = workspace.rooms.setBinding(input.platform, input.room);

          if (previous && previous !== room?.roomId) {
            void liveSessions.end(input.platform);
          }

          return room;
        }),
    },
    memory: {
      list: os.input(memoryScope).handler(({ input }) => workspace.memory.list(input)),
      search: os
        .input(
          z.object({
            scope: memoryScope,
            query: z.string().trim().max(240),
            viewerId: viewerId.optional(),
          }),
        )
        .handler(({ input }) => workspace.memory.search(input.scope, input.query, input.viewerId)),
      save: os
        .input(manualMemory)
        .handler(({ input: { scope, ...input } }) =>
          workspace.memory.save(scope, input, { type: 'manual', id: randomUUID() }),
        ),
      remove: os
        .input(memoryRecord)
        .handler(({ input }) => workspace.memory.remove(input.scope, input.id)),
    },
    assistant: {
      settings: os.handler(() => workspace.settings.assistant()),
      saveSettings: os
        .input(assistantSettings.partial())
        .handler(({ input }) => workspace.settings.saveAssistant(input)),
      watch: os.handler(({ signal }) => assistant.watch(signal)),
    },
    settings: {
      agent: os.handler(() => workspace.settings.agentState()),
      saveAgent: os
        .input(agentSettings.partial())
        .handler(({ input }) => workspace.settings.saveAgent(input)),
      openAgentDir: os.handler(() => workspace.settings.openAgentDir()),
    },
    models: {
      state: os.handler(() => workspace.models.state()),
      saveKey: os.input(presetKeyInput).handler(({ input }) => workspace.models.saveKey(input)),
      saveCustom: os
        .input(customProviderInput)
        .handler(({ input }) => workspace.models.saveCustom(input)),
      discover: os.input(modelDiscovery).handler(({ input }) => workspace.models.discover(input)),
      choice: os.input(z.uuid()).handler(({ input }) => workspace.models.choice(input)),
      select: os
        .input(z.object({ id: z.uuid(), choice: chatModelChoice }))
        .handler(({ input }) => workspace.setModelChoice(input.id, input.choice)),
    },
    conversations: {
      list: os.handler(() => workspace.list()),
      create: os.handler(() => workspace.create()),
      history: os.input(z.uuid()).handler(({ input }) => workspace.history(input)),
      usage: os.input(z.uuid()).handler(({ input }) => workspace.usage(input)),
      send: os
        .input(
          z
            .object({
              id: z.uuid(),
              text: z.string().trim().max(16000),
              attachments: z.array(attachment).max(maxAttachments).default([]),
            })
            .refine(input => input.text || input.attachments.length, '消息不能为空'),
        )
        .handler(async function* ({ input, signal }) {
          type Turns = Parameters<Parameters<typeof workspace.send>[3]>[0];
          type Update = { turns: Turns } | { done: true; error?: Error };
          const emitter = new EventEmitter();
          const updates = on(emitter, 'reply', { signal });
          const publish = (update: Update) => emitter.emit('reply', update);
          void closingAgentTabs(() =>
            workspace.send(input.id, input, browserTools, turns => publish({ turns })),
          ).then(
            () => publish({ done: true }),
            (error: unknown) =>
              publish({
                done: true,
                error: error instanceof Error ? error : new Error('聊天请求失败'),
              }),
          );

          try {
            for await (const [update] of updates as AsyncIterableIterator<[Update]>) {
              if ('done' in update) {
                if (update.error) {
                  throw update.error;
                }

                return;
              }

              yield update.turns;
            }
          } finally {
            await updates.return?.();
          }
        }),
    },
    browser: {
      navigate: os
        .input(z.object({ url: z.string().max(4096), tabId: z.uuid().optional() }))
        .handler(({ input }) => browser.navigate(input.url, input.tabId)),
      openTab: os
        .input(z.string().max(4096).optional())
        .handler(({ input }) => browser.openTab(input)),
      selectTab: os.input(z.uuid()).handler(({ input }) => browser.select(input)),
      watch: os.handler(({ signal }) => browser.watch(signal)),
      setBounds: os
        .input(
          z
            .object({ x: coordinate, y: coordinate, width: dimension, height: dimension })
            .nullable(),
        )
        .handler(({ input }) => browser.setBounds(input ?? undefined)),
      back: os.handler(() => browser.back()),
      forward: os.handler(() => browser.forward()),
      reload: os.handler(() => browser.reload()),
      close: os.input(z.uuid().optional()).handler(({ input }) => browser.close(input)),
    },
  };
}
