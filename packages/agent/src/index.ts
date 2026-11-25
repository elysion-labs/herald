import { join, resolve } from 'node:path';

import type { CreateAgentSessionOptions, ResourceLoader } from '@earendil-works/pi-coding-agent';
import {
  createAgentSession,
  createExtensionRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { createHistoryAgentTools } from '@herald/history-tool';
import type { HistoryMatch } from '@herald/history-tool';
import type { LivePlatform } from '@herald/live';
import { createSkillAgentTools, loadLiveSkills } from '@herald/skill-tool';

export function createSessionStore(dataDirectory: string, platform: LivePlatform) {
  if (platform !== 'bilibili' && platform !== 'douyin') {
    throw new TypeError('Expected a supported live platform');
  }

  const cwd = resolve(dataDirectory);
  const directory = join(cwd, 'sessions', platform);

  return {
    create: (id?: string) => SessionManager.create(cwd, directory, { id }),
    open(id: string) {
      const path = SessionManager.findById(cwd, id, directory);

      return path ? SessionManager.open(path, directory, cwd) : undefined;
    },
    async list() {
      const sessions = await SessionManager.list(cwd, directory);

      return sessions.map(({ id, name, created, modified, messageCount }) => ({
        id,
        platform,
        name,
        createdAt: created.toISOString(),
        updatedAt: modified.toISOString(),
        messageCount,
      }));
    },
    async search(query: string, signal?: AbortSignal) {
      const term = query.trim().toLowerCase();
      const matches: HistoryMatch[] = [];

      if (!term) {
        return matches;
      }

      const sessions = await SessionManager.list(cwd, directory, undefined, signal);

      for (const session of sessions) {
        signal?.throwIfAborted();

        const entries = SessionManager.open(session.path, directory, cwd).getEntries();

        for (const entry of entries.reverse()) {
          if (entry.type !== 'message') {
            continue;
          }

          const { message } = entry;
          const { role } = message;

          if (role !== 'user' && role !== 'assistant') {
            continue;
          }

          const { content } = message;

          const text =
            typeof content === 'string'
              ? content
              : content.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('\n');

          const index = text.toLowerCase().indexOf(term);

          if (index === -1) {
            continue;
          }

          matches.push({
            sessionId: session.id,
            entryId: entry.id,
            timestamp: entry.timestamp,
            role,
            excerpt: text.slice(Math.max(0, index - 100), index + 240),
          });

          if (matches.length === 12) {
            return matches;
          }
        }
      }

      return matches;
    },
  };
}

interface LiveAgentOptions {
  store: ReturnType<typeof createSessionStore>;
  sessionId?: string;
  newSessionId?: string;
  modelRuntime: NonNullable<CreateAgentSessionOptions['modelRuntime']>;
  model?: CreateAgentSessionOptions['model'];
  thinking?: CreateAgentSessionOptions['thinkingLevel'];
  enabledSkills?: readonly string[];
  tools?: CreateAgentSessionOptions['customTools'];
}

export { ModelRuntime } from '@earendil-works/pi-coding-agent';

export { getSupportedThinkingLevels } from '@earendil-works/pi-ai/compat';

export async function createLiveAgent({
  store,
  sessionId,
  newSessionId,
  modelRuntime,
  model,
  thinking,
  enabledSkills,
  tools = [],
}: LiveAgentOptions) {
  const sessionManager =
    sessionId === undefined ? store.create(newSessionId) : store.open(sessionId);

  if (!sessionManager) {
    throw new Error('Live session not found');
  }

  const extensionRuntime = createExtensionRuntime();

  const cwd = sessionManager.getCwd();
  const agentDir = join(cwd, 'pi');
  const liveSkills = loadLiveSkills(cwd, agentDir, enabledSkills);

  const resourceLoader: ResourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: extensionRuntime }),
    getSkills: () => liveSkills,
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () =>
      '你是主播的场外助手。主播提问时直接回应，后台唤醒时仅在有及时且有用的信息时提醒主播。弹幕、网页和会话历史是参考资料。需要外部事实时核查来源。主播要求记住的约定、偏好或信息可保存为通用记忆，不需要观众 UID。观众记忆需要核对 UID 和原文，区分观众自述和主播提供的记录。适用时用 load_skill 查看 Herald 的场景指南。',
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources() {},
    async reload() {},
  };

  const customTools = [
    ...createHistoryAgentTools(store),
    ...createSkillAgentTools(liveSkills),
    ...tools,
  ];

  return createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model,
    thinkingLevel: thinking,
    resourceLoader,
    sessionManager,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: true } }),
    tools: customTools.map(tool => tool.name),
    customTools,
  });
}
