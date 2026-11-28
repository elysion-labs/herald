import { reminderTrigger } from '@herald/live-assistant/settings';
import type { ReminderTrigger } from '@herald/live-assistant/settings';

import type { createLiveAgent, createSessionStore } from './index.ts';

export const reminderType = 'herald-reminder';

type SessionEntry = NonNullable<
  ReturnType<NonNullable<ReturnType<ReturnType<typeof createSessionStore>['open']>>['getEntry']>
>;

/** 识别提醒消息：直接追加时是 custom_message，作为一轮输入时是 role 为 custom 的 message。 */
function reminderEntry(entry: SessionEntry) {
  let details: unknown;

  if (entry.type === 'custom_message' && entry.customType === reminderType) {
    details = entry.details;
  } else if (
    entry.type === 'message' &&
    entry.message.role === 'custom' &&
    entry.message.customType === reminderType
  ) {
    details = entry.message.details;
  }

  return details === undefined ? undefined : reminderTrigger.safeParse(details).data;
}

interface HistoryTurn {
  id: string;
  role: 'user' | 'assistant' | 'reminder';
  text: string;
  traces: ConversationTrace[];
  images?: string[];
  trigger?: ReminderTrigger;
}

type ConversationTrace =
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; name: string; input: string; failed?: boolean };

export type AgentSession = Awaited<ReturnType<typeof createLiveAgent>>['session'];
type AssistantMessage = Extract<AgentSession['messages'][number], { role: 'assistant' }>;

function assistantContent(message: AssistantMessage, results: Map<string, boolean>) {
  const text = message.content
    .flatMap(part => (part.type === 'text' ? [part.text] : []))
    .join('\n');

  const traces = message.content.flatMap<ConversationTrace>(part => {
    if (part.type === 'thinking' && part.thinking) {
      return [{ kind: 'thinking', text: part.thinking }];
    }

    if (part.type === 'toolCall') {
      return [
        {
          kind: 'tool',
          name: part.name,
          input: JSON.stringify(part.arguments, null, 2),
          failed: results.get(part.id),
        },
      ];
    }

    return [];
  });

  return { text, traces };
}

export type LiveTurn = ReturnType<typeof assistantContent>;

export function subscribeToReplies(session: AgentSession, publish: (turns: LiveTurn[]) => void) {
  const pending: AssistantMessage[] = [];
  const results = new Map<string, boolean>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    const visible = pending.map(message => assistantContent(message, results));
    publish(visible.filter(turn => turn.text || turn.traces.length));
  }

  const unsubscribe = session.subscribe(event => {
    if (event.type === 'tool_execution_end') {
      results.set(event.toolCallId, event.isError);
    } else if (
      event.type === 'message_start' ||
      event.type === 'message_update' ||
      event.type === 'message_end'
    ) {
      if (event.message.role !== 'assistant') {
        return;
      }

      if (event.type === 'message_start') {
        pending.push(event.message);
      } else {
        pending[Math.max(0, pending.length - 1)] = event.message;
      }
    } else {
      return;
    }

    timer ??= setTimeout(flush, 32);
  });

  return () => {
    unsubscribe();

    if (timer) {
      flush();
    }
  };
}

export function readConversationHistory(entries: readonly SessionEntry[]) {
  const toolResults = new Map(
    entries.flatMap(entry => {
      if (entry.type === 'message' && entry.message.role === 'toolResult') {
        return [[entry.message.toolCallId, entry.message.isError] as const];
      }

      return [];
    }),
  );

  return entries.flatMap((entry): HistoryTurn[] => {
    const reminder = reminderEntry(entry);

    if (reminder) {
      return [{ id: entry.id, role: 'reminder' as const, text: '', traces: [], trigger: reminder }];
    }

    if (
      entry.type !== 'message' ||
      (entry.message.role !== 'assistant' && entry.message.role !== 'user')
    ) {
      return [];
    }

    const { role, content } = entry.message;

    const parts =
      typeof content === 'string' ? [{ type: 'text' as const, text: content }] : content;

    const turn =
      role === 'assistant'
        ? assistantContent(entry.message, toolResults)
        : {
            text: parts.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('\n'),
            traces: [],
            images: parts.flatMap(part =>
              part.type === 'image' ? [`data:${part.mimeType};base64,${part.data}`] : [],
            ),
          };

    return turn.text || turn.traces.length || ('images' in turn && turn.images.length)
      ? [{ id: entry.id, role, ...turn }]
      : [];
  });
}
