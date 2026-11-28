import { randomUUID } from 'node:crypto';
import { EventEmitter, on } from 'node:events';

import { adapters } from '@herald/live';
import type { LivePlatform } from '@herald/live';
import { assistantSettings } from '@herald/live-assistant/settings';
import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';

import { agentSettings } from '../shared/agent-settings.ts';
import { attachment, maxAttachments } from '../shared/attachments.ts';
import { parseLiveRoom } from '../shared/live-room.ts';
import {
  chatModelChoice,
  customProviderInput,
  modelDiscovery,
  presetKeyInput,
} from '../shared/model-settings.ts';
import { platforms } from '../shared/platforms.ts';
import type { createWorkspaceBrowser } from './browser.ts';
import { getPlatformAccount, readLiveCookies } from './platform-accounts.ts';
import { createWorkspaceAssistant, withBrowserTools } from './workspace-assistants.ts';
import type { openWorkspace } from './workspace.ts';
import type { openWorkspaces } from './workspaces.ts';

const platform = z.enum(platforms);
const workspaceId = z.uuid();
const workspaceInput = z.object({ workspaceId });
const roomInput = workspaceInput.extend({ platform });
const bindingInput = roomInput.extend({ room: z.string().trim().min(1).max(512) });
const conversationInput = workspaceInput.extend({ id: z.uuid() });
const coordinate = z.number().int().min(0).max(16384);
const dimension = coordinate.min(1);
const viewerId = z.string().trim().min(1).max(128);
const memoryScope = z.enum(['shared', ...platforms]);
const memoryInput = workspaceInput.extend({ scope: memoryScope });
const workspaceName = z.string().trim().min(1).max(60);

const manualMemory = z
  .object({
    workspaceId,
    scope: memoryScope,
    viewerId: viewerId.optional(),
    fact: z.string().trim().min(1).max(500),
    quote: z.string().trim().min(1).max(1000),
  })
  .refine(
    input => (input.scope === 'shared') === !input.viewerId,
    '请选择与观众 UID 匹配的归档范围',
  );

type Workspace = ReturnType<typeof openWorkspace>;

async function resolveBinding(platform: LivePlatform, value: string, signal?: AbortSignal) {
  const room = parseLiveRoom(platform, value);

  if (!room) {
    throw new ORPCError('BAD_REQUEST', { message: '请输入当前平台的直播间号码或官方直播链接' });
  }

  const resolve = adapters[platform].resolveRoomId;

  if (!resolve) {
    return room;
  }

  const timeout = AbortSignal.timeout(8000);

  try {
    return await resolve(room, signal ? AbortSignal.any([signal, timeout]) : timeout);
  } catch (error) {
    throw new ORPCError('BAD_GATEWAY', {
      message: '无法确认直播间号码，请核对后重试',
      cause: error,
    });
  }
}

function changeBinding(workspace: Workspace, platform: LivePlatform, room: string | null) {
  const previous = workspace.rooms.status(platform)?.roomId ?? null;

  if (
    previous !== room &&
    (workspace.assistantConversation()?.liveStartedAt || workspace.isBusy())
  ) {
    throw new ORPCError('CONFLICT', { message: '请先下播并等待工作区会话结束，再修改绑定' });
  }

  return workspace.rooms.setBinding(platform, room);
}

export function createRouter(
  workspaces: ReturnType<typeof openWorkspaces>,
  browser: ReturnType<typeof createWorkspaceBrowser>,
) {
  const { models, settings, get } = workspaces;
  const assistants = new Map<string, ReturnType<typeof createWorkspaceAssistant>>();

  function attach(id: string) {
    const service = createWorkspaceAssistant(get(id), browser);
    assistants.set(id, service);

    return service;
  }

  function service(id: string) {
    return assistants.get(id) ?? attach(id);
  }

  for (const { id } of workspaces.list()) {
    attach(id);
  }

  function dispose() {
    for (const { assistant } of assistants.values()) {
      assistant.dispose();
    }
  }

  const router = {
    workspaces: {
      list: os.handler(() => workspaces.list()),
      create: os.input(z.object({ name: workspaceName })).handler(({ input }) => {
        const row = workspaces.create(input.name);
        attach(row.id);

        return row;
      }),
      rename: os
        .input(workspaceInput.extend({ name: workspaceName }))
        .handler(({ input }) => workspaces.rename(input.workspaceId, input.name)),
      remove: os.input(workspaceInput).handler(({ input }) => {
        const id = input.workspaceId;

        if (service(id).live.isEnding()) {
          throw new ORPCError('CONFLICT', { message: '工作区正在下播复盘，请稍后再删除' });
        }

        const rows = workspaces.remove(id);
        assistants.get(id)?.assistant.dispose();
        assistants.delete(id);

        for (const row of rows) {
          service(row.id);
        }

        return rows;
      }),
      bindRoom: os.input(bindingInput).handler(async ({ input, signal }) => {
        get(input.workspaceId);
        const room = await resolveBinding(input.platform, input.room, signal);

        return changeBinding(get(input.workspaceId), input.platform, room);
      }),
      unbindRoom: os
        .input(roomInput)
        .handler(({ input }) => changeBinding(get(input.workspaceId), input.platform, null)),
    },
    platforms: {
      account: os.input(platform).handler(({ input, signal }) => getPlatformAccount(input, signal)),
    },
    rooms: {
      status: os
        .input(roomInput)
        .handler(({ input }) => get(input.workspaceId).rooms.status(input.platform)),
      list: os.input(workspaceInput).handler(({ input }) => {
        const { rooms } = get(input.workspaceId);

        return rooms.boundPlatforms().flatMap(platform => {
          const room = rooms.status(platform);

          return room ? [{ ...room, platform }] : [];
        });
      }),
      watch: os
        .input(workspaceInput.extend({ platform: platform.optional() }))
        .handler(({ input, signal }) => get(input.workspaceId).rooms.watch(input.platform, signal)),
      profile: os.input(roomInput).handler(async ({ input, signal }) => {
        const { workspaceId, platform } = input;
        const room = get(workspaceId).rooms.status(platform);
        const adapter = adapters[platform];

        if (!room || !adapter.capabilities.roomProfile) {
          return null;
        }

        const cookie = await readLiveCookies(
          platform,
          signal ?? new AbortController().signal,
        ).catch(() => null);

        return adapter.fetchRoomProfile(room.roomId, { cookie, signal });
      }),
      reconnect: os.input(roomInput).handler(({ input }) => {
        const { rooms } = get(input.workspaceId);
        rooms.connect(input.platform);

        return rooms.status(input.platform);
      }),
    },
    memory: {
      list: os
        .input(memoryInput)
        .handler(({ input }) => get(input.workspaceId).memory.list(input.scope)),
      search: os
        .input(
          memoryInput.extend({
            query: z.string().trim().max(240),
            viewerId: viewerId.optional(),
          }),
        )
        .handler(({ input }) =>
          get(input.workspaceId).memory.search(input.scope, input.query, input.viewerId),
        ),
      save: os
        .input(manualMemory)
        .handler(({ input: { workspaceId, scope, ...input } }) =>
          get(workspaceId).memory.save(scope, input, { type: 'manual', id: randomUUID() }),
        ),
      remove: os
        .input(memoryInput.extend({ id: z.uuid() }))
        .handler(({ input }) => get(input.workspaceId).memory.remove(input.scope, input.id)),
    },
    live: {
      capabilities: os.handler(() =>
        Object.values(adapters).map(({ id, label, capabilities }) => ({ id, label, capabilities })),
      ),
      start: os
        .input(workspaceInput)
        .handler(({ input }) => service(input.workspaceId).live.start()),
      end: os.input(workspaceInput).handler(({ input }) => service(input.workspaceId).live.end()),
    },
    assistant: {
      settings: os
        .input(workspaceInput)
        .handler(({ input }) => get(input.workspaceId).getAssistantSettings()),
      saveSettings: os
        .input(workspaceInput.extend({ settings: assistantSettings.partial() }))
        .handler(({ input }) => get(input.workspaceId).saveAssistantSettings(input.settings)),
      watch: os
        .input(workspaceInput)
        .handler(({ input, signal }) => service(input.workspaceId).assistant.watch(signal)),
      typing: os.input(conversationInput).handler(({ input }) => {
        get(input.workspaceId).conversation(input.id);
        service(input.workspaceId).assistant.typing(input.id);
      }),
      feedback: os
        .input(
          workspaceInput.extend({
            conversationId: z.uuid(),
            summary: z.string().trim().min(1).max(300),
            verdict: z.enum(['adopt', 'ignore']),
          }),
        )
        .handler(({ input }) =>
          get(input.workspaceId).addFeedback(
            input.conversationId,
            `${input.verdict === 'adopt' ? '采纳了' : '忽略了'}「${input.summary}」`,
          ),
        ),
    },
    settings: {
      agent: os.handler(() => settings.agentState()),
      saveAgent: os
        .input(agentSettings.partial())
        .handler(({ input }) => settings.saveAgent(input)),
      openAgentDir: os.handler(() => settings.openAgentDir()),
    },
    models: {
      state: os.handler(() => models.state()),
      saveKey: os.input(presetKeyInput).handler(({ input }) => models.saveKey(input)),
      saveCustom: os.input(customProviderInput).handler(({ input }) => models.saveCustom(input)),
      discover: os.input(modelDiscovery).handler(({ input }) => models.discover(input)),
      choice: os.input(conversationInput).handler(({ input }) => {
        get(input.workspaceId).conversation(input.id);

        return models.choice(input.id);
      }),
      select: os
        .input(conversationInput.extend({ choice: chatModelChoice }))
        .handler(({ input }) => get(input.workspaceId).setModelChoice(input.id, input.choice)),
    },

    conversations: {
      list: os.input(workspaceInput).handler(({ input }) => get(input.workspaceId).list()),
      create: os.input(workspaceInput).handler(({ input }) => get(input.workspaceId).create()),
      history: os
        .input(conversationInput)
        .handler(({ input }) => get(input.workspaceId).history(input.id)),
      usage: os
        .input(conversationInput)
        .handler(({ input }) => get(input.workspaceId).usage(input.id)),
      send: os
        .input(
          z
            .object({
              workspaceId,
              id: z.uuid(),
              text: z.string().trim().max(16000),
              attachments: z.array(attachment).max(maxAttachments).default([]),
            })
            .refine(input => input.text || input.attachments.length, '消息不能为空'),
        )
        .handler(async function* ({ input, signal }) {
          const workspace = get(input.workspaceId);
          type Turns = Parameters<Parameters<typeof workspace.send>[3]>[0];
          type Update = { turns: Turns } | { done: true; error?: Error };
          const emitter = new EventEmitter();
          const updates = on(emitter, 'reply', { signal });
          const publish = (update: Update) => emitter.emit('reply', update);
          void withBrowserTools(browser, tools =>
            workspace.send(input.id, input, tools, turns => publish({ turns })),
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
        .handler(async ({ input }) => {
          try {
            await browser.navigate(input.url, input.tabId);
          } catch (error) {
            if (error instanceof TypeError) {
              throw new ORPCError('BAD_REQUEST', { message: error.message, cause: error });
            }

            throw new ORPCError('BAD_GATEWAY', {
              message: '无法打开网页，请检查网址和网络连接后重试。',
              cause: error,
            });
          }
        }),
      openTab: os
        .input(z.string().max(4096).optional())
        .handler(({ input }) => browser.openTab(input)),
      selectTab: os.input(z.uuid()).handler(({ input }) => browser.select(input)),
      watch: os.handler(({ signal }) => browser.watch(signal)),
      setBounds: os
        .input(
          z
            .object({
              frame: z.object({
                x: coordinate,
                y: coordinate,
                width: dimension,
                height: dimension,
              }),
              pictureInPicture: z.boolean(),
            })
            .nullable(),
        )
        .handler(({ input }) => browser.setBounds(input?.frame, input?.pictureInPicture ?? false)),
      back: os.handler(() => browser.back()),
      forward: os.handler(() => browser.forward()),
      reload: os.handler(() => browser.reload()),
      close: os.input(z.uuid().optional()).handler(({ input }) => browser.close(input)),
    },
  };

  return { router, dispose };
}
