import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { freshDanmaku } from '@herald/danmaku';
import { adapters } from '@herald/live';
import type { LivePlatform } from '@herald/live';
import { createRouterClient, ORPCError } from '@orpc/server';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { createRouter } from './router.ts';
import { openWorkspaces } from './workspaces.ts';

vi.mock('electron', () => ({
  app: { getAppPath: () => fileURLToPath(new URL('../../', import.meta.url)) },
  safeStorage: {},
  session: {},
  shell: {},
}));

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'herald-workspaces-'));
  const registry = openWorkspaces(directory);

  const browser = { webContents: {}, agentTabs: () => new Set<string>() } as Parameters<
    typeof createRouter
  >[1];

  const { router, dispose } = createRouter(registry, browser);
  const rpc = createRouterClient(router);

  return {
    registry,
    rpc,
    close(this: void) {
      dispose();
      registry.dispose();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('工作区', () => {
  it('启动时恢复未提交的删除并清理已删除的目录', () => {
    const directory = mkdtempSync(join(tmpdir(), 'herald-workspaces-'));
    const registry = openWorkspaces(directory);
    const [workspace] = registry.list();
    const path = join(directory, 'workspaces', workspace.id);
    const orphan = join(directory, 'workspaces', `${randomUUID()}.removed`);
    registry.dispose();

    try {
      renameSync(path, `${path}.removed`);
      mkdirSync(orphan);
      const reopened = openWorkspaces(directory);

      try {
        expect(reopened.list()).toEqual([workspace]);
        expect(existsSync(path)).toBe(true);
        expect(existsSync(orphan)).toBe(false);
      } finally {
        reopened.dispose();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('从空库创建默认工作区，并隔离设置、会话和记忆 RPC', async () => {
    const { rpc, close } = setup();

    try {
      const [a] = await rpc.workspaces.list();
      const b = await rpc.workspaces.create({ name: '另一场直播' });
      const workspaceA = { workspaceId: a.id };
      const workspaceB = { workspaceId: b.id };

      expect(a.name).toBe('默认工作区');
      expect(await rpc.rooms.list(workspaceA)).toEqual([]);
      expect(await rpc.conversations.list(workspaceA)).toMatchObject([{ mode: 'assistant' }]);
      expect(await rpc.conversations.list(workspaceB)).toMatchObject([{ mode: 'assistant' }]);

      const { id } = await rpc.conversations.create(workspaceA);
      await expect(rpc.conversations.history({ ...workspaceB, id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(rpc.models.choice({ ...workspaceB, id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      await rpc.memory.save({ ...workspaceA, scope: 'shared', fact: '偏好', quote: '原话' });
      expect(await rpc.memory.list({ ...workspaceB, scope: 'shared' })).toEqual([]);
      await rpc.assistant.saveSettings({ ...workspaceA, settings: { cooldownSeconds: 100 } });
      expect(await rpc.assistant.settings(workspaceA)).toMatchObject({ cooldownSeconds: 100 });
      expect(await rpc.assistant.settings(workspaceB)).toMatchObject({ cooldownSeconds: 60 });
    } finally {
      close();
    }
  });

  it('拒绝重复直播间，合并弹幕，同一助手会话结束后保存双平台快照', async () => {
    for (const adapter of Object.values(adapters)) {
      vi.spyOn(adapter, 'createChat').mockReturnValue({
        start: async () => undefined,
        state: () => 'connected',
        dispose: async () => undefined,
      });
    }

    vi.spyOn(adapters.bilibili, 'resolveRoomId').mockResolvedValue('10001');
    const { registry, rpc, close } = setup();

    try {
      const [a] = await rpc.workspaces.list();
      const b = await rpc.workspaces.create({ name: '第二工作区' });
      const workspaceA = { workspaceId: a.id };
      const workspaceB = { workspaceId: b.id };
      await rpc.workspaces.bindRoom({ ...workspaceA, platform: 'bilibili', room: '1' });
      await rpc.workspaces.bindRoom({ ...workspaceA, platform: 'douyin', room: '2' });
      await expect(
        rpc.workspaces.bindRoom({ ...workspaceB, platform: 'bilibili', room: '10001' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      const first = registry.get(a.id).danmaku;
      const second = registry.get(b.id).danmaku;
      const at = Date.now();

      const message = (evidenceId: string, platform: LivePlatform) => ({
        evidenceId,
        platform,
        receivedAt: at,
        roomId: '1',
        authorId: '123',
        authorName: '观众',
        text: evidenceId,
      });

      first.add(message('first', 'bilibili'));
      const platforms = ['bilibili', 'douyin'] as const;
      const initial = freshDanmaku(first, platforms, 0);
      first.add(message('second', 'douyin'));
      second.add(message('other', 'bilibili'));
      expect(freshDanmaku(first, platforms, initial.cursor)).toMatchObject({ count: 1 });
      expect(freshDanmaku(first, platforms, 0).text).toContain('"platform":"douyin"');
      expect(first.find('other')).toBeUndefined();
      expect(first.viewers({ platforms })).toHaveLength(2);

      await rpc.assistant.saveSettings({
        ...workspaceA,
        settings: {
          liveStart: { enabled: false },
          liveEnd: { enabled: false },
        },
      });
      const started = await rpc.live.start(workspaceA);
      expect(started?.livePlatforms).toEqual(platforms);
      first.add(message('still-buffered', 'bilibili'));
      await rpc.live.end(workspaceA);
      expect(await rpc.conversations.list(workspaceA)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: started?.id, mode: 'chat', livePlatforms: [...platforms] }),
          expect.objectContaining({ mode: 'assistant', liveStartedAt: null }),
        ]),
      );
      expect(await rpc.conversations.list(workspaceB)).toMatchObject([{ mode: 'assistant' }]);
      const rooms = await rpc.rooms.watch(workspaceA);
      await rooms.next();
      const disconnected = rooms.next();
      const reminders = await rpc.assistant.watch(workspaceA);
      const stopped = reminders.next();

      await rpc.workspaces.remove(workspaceA);
      await expect(disconnected).resolves.toMatchObject({ done: true });
      await expect(stopped).resolves.toMatchObject({ done: true });
      expect(await rpc.workspaces.list()).toEqual([b]);
      expect(await rpc.rooms.list(workspaceB)).toEqual([]);
    } finally {
      close();
    }
  });

  it('开播推荐和下播复盘失败时发送带触发原因的事件，场次仍会归档', async () => {
    vi.spyOn(adapters.douyin, 'createChat').mockReturnValue({
      start: async () => undefined,
      state: () => 'connected',
      dispose: async () => undefined,
    });

    const { registry, rpc, close } = setup();

    try {
      const [workspace] = await rpc.workspaces.list();
      const input = { workspaceId: workspace.id };
      await rpc.workspaces.bindRoom({ ...input, platform: 'douyin', room: '2' });

      vi.spyOn(registry.get(workspace.id), 'remind')
        .mockRejectedValueOnce(
          new ORPCError('PRECONDITION_FAILED', { message: '请在设置中配置模型凭证' }),
        )
        .mockRejectedValueOnce(new ORPCError('BAD_GATEWAY', { message: '模型调用失败' }));

      const stream = await rpc.assistant.watch(input);
      const start = stream.next();
      const conversation = await rpc.live.start(input);
      await expect(start).resolves.toMatchObject({
        value: { phase: 'start', trigger: { kind: 'liveStart' } },
      });
      await expect(stream.next()).resolves.toMatchObject({
        value: {
          conversationId: conversation?.id,
          phase: 'done',
          delivered: false,
          trigger: { kind: 'liveStart' },
          error: '请在设置中配置模型凭证',
          errorCode: 'PRECONDITION_FAILED',
        },
      });

      const end = stream.next();
      await rpc.live.end(input);
      await expect(end).resolves.toMatchObject({
        value: { phase: 'start', trigger: { kind: 'liveEnd' } },
      });
      await expect(stream.next()).resolves.toMatchObject({
        value: {
          conversationId: conversation?.id,
          phase: 'done',
          delivered: false,
          trigger: { kind: 'liveEnd' },
          error: '模型调用失败',
          errorCode: 'BAD_GATEWAY',
        },
      });
      expect(await rpc.conversations.list(input)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: conversation?.id, mode: 'chat' })]),
      );
    } finally {
      close();
    }
  });
});
