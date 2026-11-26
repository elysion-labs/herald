import { useEffect, useState } from 'react';

import { describeTrigger } from '../shared/assistant-settings.ts';
import type { ReminderTrigger } from '../shared/assistant-settings.ts';
import { rpc } from './rpc.ts';

export type Conversation = Awaited<ReturnType<typeof rpc.conversations.list>>[number];

/** 弹幕栏顶部：当前助手会话的实时提醒卡片。 */
export function AssistantReminders({ conversationId }: { conversationId: string }) {
  return <ReminderCards cards={useReminderCards(conversationId)} />;
}

interface ReminderCard {
  key: number;
  trigger: ReminderTrigger;
  text: string;
}

const keepCards = 3;

/** 弹幕面板里的提醒卡片：只看该平台助手会话的提醒，模型判定无需提醒的自动移除。 */
function useReminderCards(conversationId: string) {
  const [cards, setCards] = useState<ReminderCard[]>([]);

  useEffect(() => {
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
