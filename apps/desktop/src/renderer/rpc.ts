import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/message-port';
import type { RouterClient } from '@orpc/server';

import type { createRouter } from '../main/router.ts';
import { rpcPortMessage } from '../shared/platforms.ts';

const { port1, port2 } = new MessageChannel();
window.postMessage(rpcPortMessage, '*', [port2]);
port1.start();

export const transport: RouterClient<ReturnType<typeof createRouter>['router']> = createORPCClient(
  new RPCLink({ port: port1 }),
);

type Platform = Parameters<typeof transport.rooms.status>[0]['platform'];
interface WorkspaceInput {
  workspaceId: string;
}
type ScopedInput<T extends (input: never) => unknown> = Omit<Parameters<T>[0], 'workspaceId'>;

async function defaultWorkspace(): Promise<WorkspaceInput> {
  const [workspace] = await transport.workspaces.list();

  if (!workspace) {
    throw new Error('找不到默认工作区');
  }

  return { workspaceId: workspace.id };
}

export function workspaceRpc(scope: () => Promise<WorkspaceInput>) {
  const { assistant, conversations, live, memory, models, rooms, workspaces } = transport;

  return {
    ...transport,
    assistant: {
      settings: async () => assistant.settings(await scope()),
      saveSettings: async (settings: Parameters<typeof assistant.saveSettings>[0]['settings']) =>
        assistant.saveSettings({ ...(await scope()), settings }),
      watch: async (_input?: undefined, options?: Parameters<typeof assistant.watch>[1]) =>
        assistant.watch(await scope(), options),
      typing: async (id: string) => assistant.typing({ ...(await scope()), id }),
      feedback: async (input: ScopedInput<typeof assistant.feedback>) =>
        assistant.feedback({ ...(await scope()), ...input }),
    },
    conversations: {
      list: async () =>
        (await conversations.list(await scope())).map(row => ({
          ...row,
          platform: row.livePlatforms[0] ?? null,
        })),
      create: async () => conversations.create(await scope()),
      history: async (id: string) => conversations.history({ ...(await scope()), id }),
      usage: async (id: string) => conversations.usage({ ...(await scope()), id }),
      send: async (input: ScopedInput<typeof conversations.send>) =>
        conversations.send({ ...(await scope()), ...input }),
    },
    live: {
      capabilities: live.capabilities,
      start: async (_platform: Platform) => live.start(await scope()),
      end: async (_platform: Platform) => live.end(await scope()),
    },
    memory: {
      list: async (scopeName: Parameters<typeof memory.list>[0]['scope']) =>
        memory.list({ ...(await scope()), scope: scopeName }),
      search: async (input: ScopedInput<typeof memory.search>) =>
        memory.search({ ...(await scope()), ...input }),
      save: async (input: ScopedInput<typeof memory.save>) =>
        memory.save({ ...(await scope()), ...input }),
      remove: async (input: ScopedInput<typeof memory.remove>) =>
        memory.remove({ ...(await scope()), ...input }),
    },
    models: {
      ...models,
      choice: async (id: string) => models.choice({ ...(await scope()), id }),
      select: async (input: ScopedInput<typeof models.select>) =>
        models.select({ ...(await scope()), ...input }),
    },
    rooms: {
      status: async (platform: Platform) => rooms.status({ ...(await scope()), platform }),
      list: async () => rooms.list(await scope()),
      watch: async (platform: Platform | undefined, options?: Parameters<typeof rooms.watch>[1]) =>
        rooms.watch({ ...(await scope()), platform }, options),
      profile: async (platform: Platform) => rooms.profile({ ...(await scope()), platform }),
      reconnect: async (platform: Platform) => rooms.reconnect({ ...(await scope()), platform }),
      async setBinding({ platform, room }: { platform: Platform; room: string | null }) {
        const input = { ...(await scope()), platform };

        return room === null
          ? workspaces.unbindRoom(input)
          : workspaces.bindRoom({ ...input, room });
      },
    },
  };
}

/** 单工作区入口，工作区选择器接入后由界面提供作用域。 */
export const rpc = workspaceRpc(defaultWorkspace);
