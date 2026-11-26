import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Radio } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

import { describeTrigger } from '../shared/assistant-settings.ts';
import type { ReminderTrigger } from '../shared/assistant-settings.ts';
import { rpc } from './rpc.ts';

export type Conversation = Awaited<ReturnType<typeof rpc.conversations.list>>[number];
type Mode = Conversation['mode'];

const conversationsKey = ['conversations'];

export function useSetMode() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; mode: Mode }) => rpc.conversations.setMode(input),
    onSuccess: () => client.invalidateQueries({ queryKey: conversationsKey }),
  });
}

/** 顶栏开关：把当前会话切换为主播助手模式（每个平台只能有一个）。 */
export function AssistantModeToggle({ conversation }: { conversation: Conversation }) {
  const setMode = useSetMode();
  const active = conversation.mode === 'assistant';
  const label = active ? '关闭主播助手模式' : '开启主播助手模式：注入弹幕并接收提醒';

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground hover:text-foreground aria-pressed:text-foreground shrink-0"
      aria-pressed={active}
      aria-label={label}
      title={label}
      disabled={setMode.isPending}
      onClick={() => setMode.mutate({ id: conversation.id, mode: active ? 'chat' : 'assistant' })}
    >
      <Radio />
    </Button>
  );
}

/** 弹幕面板顶部：提醒正发往哪个会话（或在当前会话开启助手），以及该会话的实时提醒卡片。 */
export function AssistantSection({ conversation }: { conversation: Conversation }) {
  const { data: conversations } = useQuery({
    queryKey: conversationsKey,
    queryFn: () => rpc.conversations.list(),
  });

  const assistant = conversations?.find(
    item => item.platform === conversation.platform && item.mode === 'assistant',
  );

  const cards = useReminderCards(assistant?.id);

  return (
    <>
      <AssistantBinding conversation={conversation} assistant={assistant} />
      <ReminderCards cards={cards} />
    </>
  );
}

function AssistantBinding({
  conversation,
  assistant,
}: {
  conversation: Conversation;
  assistant?: Conversation;
}) {
  const setMode = useSetMode();

  if (assistant?.id === conversation.id) {
    return (
      <p className="assistant-binding">
        <Radio className="size-3.5" />
        提醒会发到这个会话
      </p>
    );
  }

  return (
    <p className="assistant-binding">
      <Radio className="size-3.5" />
      {assistant ? (
        <>
          <span className="min-w-0 truncate">助手：{assistant.title}</span>
          <Link
            to="/chat/$id"
            params={{ id: assistant.id }}
            className="text-foreground ml-auto shrink-0 underline-offset-3 hover:underline"
          >
            前往
          </Link>
        </>
      ) : (
        <>
          <span>未开启主播助手</span>
          <button
            type="button"
            className="text-foreground ml-auto shrink-0 underline-offset-3 hover:underline"
            disabled={setMode.isPending}
            onClick={() => setMode.mutate({ id: conversation.id, mode: 'assistant' })}
          >
            在此会话开启
          </button>
        </>
      )}
    </p>
  );
}

interface ReminderCard {
  key: number;
  trigger: ReminderTrigger;
  text: string;
}

const keepCards = 3;

/** 弹幕面板里的提醒卡片：只看该平台助手会话的提醒，模型判定无需提醒的自动移除。 */
function useReminderCards(conversationId: string | undefined) {
  const [cards, setCards] = useState<ReminderCard[]>([]);

  useEffect(() => {
    if (!conversationId) {
      return undefined;
    }

    const controller = new AbortController();
    let key = 0;

    async function watch() {
      try {
        const stream = await rpc.assistant.watch(undefined, { signal: controller.signal });

        for await (const event of stream) {
          if (event.conversationId !== conversationId) {
            continue;
          }

          if (event.phase === 'start') {
            key += 1;
            const card = { key, trigger: event.trigger, text: '' };
            setCards(current => [...current, card].slice(-keepCards));
          } else if (event.phase === 'update') {
            const text = event.turns.map(turn => turn.text).join('\n');
            setCards(current => current.map(card => (card.key === key ? { ...card, text } : card)));
          } else if (!event.delivered) {
            setCards(current => current.filter(card => card.key !== key));
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('提醒订阅失败', error);
        }
      }
    }

    void watch();

    return () => controller.abort();
  }, [conversationId]);

  return cards;
}

function ReminderCards({ cards }: { cards: ReminderCard[] }) {
  if (!cards.length) {
    return null;
  }

  return (
    <ol className="grid gap-1.5 px-3 pb-2" aria-label="助手提醒">
      {cards.map(card => (
        <li key={card.key} className="reminder-card">
          <p className="text-muted-foreground truncate text-[11px]">
            {describeTrigger(card.trigger)}
          </p>
          <p className="line-clamp-4 text-[13px] leading-snug whitespace-pre-wrap">
            {card.text || '正在准备建议…'}
          </p>
        </li>
      ))}
    </ol>
  );
}
