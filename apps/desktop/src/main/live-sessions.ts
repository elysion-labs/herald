import type { LivePlatform } from '@herald/live';
import type { createLiveAssistant } from '@herald/live-assistant';

import type { openWorkspace } from './workspace.ts';

type Workspace = ReturnType<typeof openWorkspace>;
type Assistant = Pick<ReturnType<typeof createLiveAssistant>, 'run'>;

/**
 * 按直播场次组织助手会话：开播时当前助手会话成为本场会话并推荐话题；
 * 下播时先复盘，再把本场转为普通会话（标题为开播时间），并开好下一场。
 */
export function createLiveSessions(workspace: Workspace, assistant: Assistant) {
  const ending = new Set<LivePlatform>();

  async function start(platform: LivePlatform) {
    const before = workspace.assistantConversation(platform);
    const conversation = workspace.beginLiveSession(platform);

    // 应用在直播中途重启时，本场已经开始过，不再重复推荐。
    if (
      !before?.liveStartedAt &&
      conversation?.liveStartedAt &&
      workspace.settings.assistant().liveStart.enabled
    ) {
      await assistant.run(conversation.id, {
        kind: 'liveStart',
        startedAt: conversation.liveStartedAt,
      });
    }
  }

  async function end(platform: LivePlatform) {
    const current = workspace.assistantConversation(platform);

    if (!current?.liveStartedAt || ending.has(platform)) {
      return;
    }

    ending.add(platform);

    try {
      if (workspace.settings.assistant().liveEnd.enabled) {
        await assistant.run(current.id, {
          kind: 'liveEnd',
          startedAt: current.liveStartedAt,
          endedAt: Date.now(),
        });
      }
    } finally {
      workspace.endLiveSession(platform);
      ending.delete(platform);
    }
  }

  const unsubscribe = workspace.rooms.onLiveChange((platform, live) => {
    const task = live === 'live' ? start(platform) : end(platform);

    task.catch((error: unknown) => console.error('直播场次处理失败', platform, error));
  });

  return { start, end, dispose: unsubscribe };
}
