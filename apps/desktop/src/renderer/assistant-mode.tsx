import { describeTrigger, liveTime, reminderPlatform } from '@herald/live-assistant/settings';
import type { ReminderTrigger } from '@herald/live-assistant/settings';
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Radio, Square, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

import { RoomIndicators, useRooms } from './live-status.tsx';
import { PlatformIcon } from './platform-icon.tsx';
import { rpc } from './rpc.ts';
import { conversationsKey, useWorkspace, workspaceKey } from './workspace-context.ts';

export type Conversation = Awaited<ReturnType<typeof rpc.conversations.list>>[number];

/** 弹幕栏顶部：当前助手会话的实时提醒卡片。 */
export function AssistantReminders({ conversationId }: { conversationId: string }) {
  return <ReminderCards conversationId={conversationId} cards={useReminderCards(conversationId)} />;
}

interface ReminderCard {
  key: number;
  trigger: ReminderTrigger;
  text: string;
  done: boolean;
}

type Verdict = 'adopt' | 'ignore';

const keepCards = 3;

/** 弹幕面板里的提醒卡片：只看该平台助手会话的提醒，模型判定无需提醒的自动移除。 */
function useReminderCards(conversationId: string) {
  const { id: workspaceId } = useWorkspace();
  const [cards, setCards] = useState<ReminderCard[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    let key = 0;

    async function watch() {
      try {
        const stream = await rpc.assistant.watch({ workspaceId }, { signal: controller.signal });

        for await (const event of stream) {
          if (event.conversationId !== conversationId) {
            continue;
          }

          if (event.phase === 'start') {
            key += 1;
            const card = { key, trigger: event.trigger, text: '', done: false };
            setCards(current => [...current, card].slice(-keepCards));
          } else if (event.phase === 'update') {
            const text = event.turns.map(turn => turn.text).join('\n');
            setCards(current => current.map(card => (card.key === key ? { ...card, text } : card)));
          } else if (event.delivered) {
            setCards(current =>
              current.map(card => (card.key === key ? { ...card, done: true } : card)),
            );
          } else {
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
  }, [conversationId, workspaceId]);

  return cards;
}

/** 采纳 / 忽略：反馈会在该会话下次运行时交给 agent，用于调整之后的建议。 */
function CardFeedback({ conversationId, card }: { conversationId: string; card: ReminderCard }) {
  const { id: workspaceId } = useWorkspace();
  const [verdict, setVerdict] = useState<Verdict>();

  const send = useMutation({
    mutationFn: (next: Verdict) =>
      rpc.assistant.feedback({
        workspaceId,
        conversationId,
        verdict: next,
        summary: `${describeTrigger(card.trigger)}：${card.text.slice(0, 120)}`.slice(0, 300),
      }),
    onSuccess: (_, next) => setVerdict(next),
  });

  if (verdict) {
    return (
      <p className="text-muted-foreground text-[11px]">
        {verdict === 'adopt' ? '已采纳' : '已忽略'}
      </p>
    );
  }

  return (
    <div className="flex gap-1">
      <Button
        size="xs"
        variant="ghost"
        className="text-muted-foreground hover:text-foreground"
        disabled={send.isPending}
        onClick={() => send.mutate('adopt')}
      >
        <ThumbsUp data-icon="inline-start" />
        采纳
      </Button>
      <Button
        size="xs"
        variant="ghost"
        className="text-muted-foreground hover:text-foreground"
        disabled={send.isPending}
        onClick={() => send.mutate('ignore')}
      >
        <ThumbsDown data-icon="inline-start" />
        忽略
      </Button>
    </div>
  );
}

function ReminderCards({
  conversationId,
  cards,
}: {
  conversationId: string;
  cards: ReminderCard[];
}) {
  if (!cards.length) {
    return null;
  }

  return (
    <ol className="grid gap-1.5 px-3 pb-2" aria-label="助手提醒">
      {cards.map(card => {
        const platform = reminderPlatform(card.trigger);
        const title = describeTrigger(card.trigger);

        return (
          <li key={card.key} className="reminder-card">
            <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[11px]">
              {platform ? <PlatformIcon platform={platform} size={12} /> : null}
              <span className="truncate" title={title}>
                {title}
              </span>
            </p>
            <p className="line-clamp-4 text-[13px] leading-snug whitespace-pre-wrap">
              {card.text || '正在准备建议…'}
            </p>
            {card.done && <CardFeedback conversationId={conversationId} card={card} />}
          </li>
        );
      })}
    </ol>
  );
}

function useLiveAction(action: 'start' | 'end') {
  const { id: workspaceId } = useWorkspace();
  const client = useQueryClient();
  const mutationKey = [...workspaceKey(workspaceId), 'live'];
  const busy = useIsMutating({ mutationKey }) > 0;

  const mutation = useMutation({
    mutationKey,
    async mutationFn() {
      await rpc.live[action]({ workspaceId });
    },
    onSettled: () => client.invalidateQueries({ queryKey: conversationsKey(workspaceId) }),
  });

  return { mutation, busy };
}

/** 一次开播或下播操作覆盖本工作区的所有直播间。 */
export function LiveControl({ conversation }: { conversation: Conversation }) {
  const { data: rooms } = useRooms();
  const active = conversation.liveStartedAt !== null;
  const { mutation, busy } = useLiveAction(active ? 'end' : 'start');
  const label = active ? '下播' : '开播';
  const Icon = active ? Square : Radio;

  return (
    <div className="relative flex shrink-0 items-center gap-2">
      <RoomIndicators rooms={rooms} compact />
      {conversation.liveStartedAt && (
        <span className="text-muted-foreground hidden text-xs tabular-nums min-[1200px]:inline">
          {liveTime(conversation.liveStartedAt)} 开播
        </span>
      )}
      <Button
        size="sm"
        variant={active ? 'ghost' : 'secondary'}
        disabled={busy || (!active && !rooms?.length)}
        title={label}
        onClick={() => mutation.mutate()}
      >
        <Icon data-icon="inline-start" />
        {busy && active ? '正在下播…' : label}
      </Button>
      {mutation.error && (
        <p
          role="alert"
          className="error bg-popover absolute top-full right-0 z-10 min-w-40 rounded-md p-2"
        >
          {mutation.error.message}
        </p>
      )}
    </div>
  );
}

/** 未开播的助手会话可以直接开播，或收起遮罩后先准备。 */
export function StartLiveOverlay({
  conversation,
  hidden,
  onDismiss,
}: {
  conversation?: Conversation;
  hidden: boolean;
  onDismiss: () => void;
}) {
  if (conversation?.mode !== 'assistant' || conversation.liveStartedAt || hidden) {
    return null;
  }

  return <StartLivePanel onDismiss={onDismiss} />;
}

function StartLivePanel({ onDismiss }: { onDismiss: () => void }) {
  const { name } = useWorkspace();
  const { data: rooms, error, isPending } = useRooms();
  const { mutation, busy } = useLiveAction('start');
  const bound = Boolean(rooms?.length);

  return (
    <div className="start-live-overlay">
      <div className="grid max-w-sm justify-items-center gap-3 text-center">
        <Radio className="text-muted-foreground size-7" />
        <h2 className="text-lg font-medium">{name}</h2>
        {bound ? (
          <RoomIndicators rooms={rooms} />
        ) : (
          <p className="text-muted-foreground text-sm">
            {error?.message ?? (isPending ? '正在读取直播间…' : '还没有绑定直播间')}
          </p>
        )}
        <Button
          size="lg"
          className="mt-2 min-w-36"
          disabled={!bound || busy}
          onClick={() => mutation.mutate()}
        >
          <Radio data-icon="inline-start" />
          {busy ? '正在开播…' : '开播'}
        </Button>
        {!bound && !isPending && !error && (
          <Link
            to="/settings"
            className="text-foreground text-xs underline-offset-3 hover:underline"
          >
            去设置绑定直播间
          </Link>
        )}
        {mutation.error && (
          <p role="alert" className="text-destructive text-xs">
            {mutation.error.message}
          </p>
        )}
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onDismiss}>
          先在这里准备
        </Button>
      </div>
    </div>
  );
}
