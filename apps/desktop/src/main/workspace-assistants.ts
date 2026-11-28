import { createBrowserAgentTools } from '@herald/browser-tool';
import { createLiveAssistant } from '@herald/live-assistant';

import type { createWorkspaceBrowser } from './browser.ts';
import { createLiveSessions } from './live-sessions.ts';
import type { openWorkspace } from './workspace.ts';

type Workspace = ReturnType<typeof openWorkspace>;
type Browser = ReturnType<typeof createWorkspaceBrowser>;
type ReplyTurns = Parameters<Parameters<Workspace['remind']>[3]>[0];

export async function withBrowserTools<T>(
  browser: Browser,
  run: (tools: ReturnType<typeof createBrowserAgentTools>) => Promise<T>,
) {
  const opened = new Set<string>();

  const tools = createBrowserAgentTools({
    webContents: {
      ...browser.webContents,
      async open(url) {
        const id = await browser.webContents.open(url);
        opened.add(id);

        return id;
      },
    },
  });

  try {
    return await run(tools);
  } finally {
    for (const id of browser.agentTabs()) {
      if (opened.has(id)) {
        browser.close(id);
      }
    }
  }
}

export function createWorkspaceAssistant(workspace: Workspace, browser: Browser) {
  const assistant = createLiveAssistant({
    activeConversation() {
      const current = workspace.assistantConversation();

      return current?.liveStartedAt && !live.isEnding() ? current.id : undefined;
    },
    platforms: workspace.rooms.boundPlatforms,
    isRunning: workspace.isRunning,
    remind: (id, trigger, publish: (turns: ReplyTurns) => void) =>
      withBrowserTools(browser, tools => workspace.remind(id, trigger, tools, publish)),
    settings: workspace.getAssistantSettings,
    viewerFacts: (platform, viewerId) =>
      workspace.memory
        .list(platform)
        .filter(record => record.viewerId === viewerId)
        .map(record => record.fact),
    roomConnected: () =>
      workspace.rooms
        .boundPlatforms()
        .some(platform => workspace.rooms.status(platform)?.state === 'connected'),
    onMessage: listener => workspace.rooms.onMessage(listener),
    onActivity: listener => workspace.rooms.onActivity(listener),
    viewerSeenBefore: (platform, viewerId) => {
      const before = workspace.assistantConversation()?.liveStartedAt ?? Date.now();

      return workspace.danmaku.hasViewer(platform, viewerId, before);
    },
  });

  const live = createLiveSessions(workspace, assistant);

  return { assistant, live };
}
