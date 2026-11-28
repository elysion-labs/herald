import { supports } from '@herald/live';
import type { createLiveAssistant } from '@herald/live-assistant';
import { ORPCError } from '@orpc/server';

import type { openWorkspace } from './workspace.ts';

type Workspace = ReturnType<typeof openWorkspace>;
type Assistant = Pick<ReturnType<typeof createLiveAssistant>, 'run'>;

/** 开播和复盘以工作区为单位，直播结束后保留本场的平台快照。 */
export function createLiveSessions(workspace: Workspace, assistant: Assistant) {
  let ending = false;

  function start() {
    const before = workspace.assistantConversation();

    if (before?.liveStartedAt) {
      return before;
    }

    const platforms = workspace.rooms.boundPlatforms();

    if (!platforms.length) {
      throw new ORPCError('PRECONDITION_FAILED', { message: '请先绑定至少一个直播间' });
    }

    const conversation = workspace.beginLiveSession(platforms);

    if (conversation?.liveStartedAt && workspace.getAssistantSettings().liveStart.enabled) {
      void assistant.run(conversation.id, {
        kind: 'liveStart',
        startedAt: conversation.liveStartedAt,
      });
    }

    return conversation;
  }

  async function end() {
    const current = workspace.assistantConversation();

    if (!current?.liveStartedAt || ending) {
      return;
    }

    ending = true;

    try {
      if (
        workspace.getAssistantSettings().liveEnd.enabled &&
        supports(current.livePlatforms, 'danmaku')
      ) {
        await assistant.run(current.id, {
          kind: 'liveEnd',
          startedAt: current.liveStartedAt,
          endedAt: Date.now(),
        });
      }
    } finally {
      try {
        workspace.endLiveSession();
      } finally {
        ending = false;
      }
    }
  }

  return { start, end, isEnding: () => ending };
}
