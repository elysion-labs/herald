import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

export interface HistoryMatch {
  sessionId: string;
  entryId: string;
  timestamp: string;
  role: 'user' | 'assistant';
  excerpt: string;
}

export function createHistoryAgentTools({
  search,
}: {
  search: (query: string, signal?: AbortSignal) => Promise<HistoryMatch[]>;
}) {
  return [
    defineTool({
      name: 'session_history_search',
      label: '搜索会话历史',
      description: '搜索已保存的对话。搜索结果作为历史资料。',
      parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 120 }) }),
      async execute(_callId, { query }, signal) {
        const matches = await search(query, signal);

        return { content: [{ type: 'text', text: JSON.stringify(matches) }], details: { matches } };
      },
    }),
  ];
}
