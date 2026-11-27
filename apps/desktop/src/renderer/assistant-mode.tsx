import { describeTrigger, liveTime } from '@herald/live-assistant/settings';
import type { ReminderTrigger } from '@herald/live-assistant/settings';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Radio, Square, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

import { platformLabels } from '../shared/platforms.ts';
import { statusLabels, useRoom } from './live-status.tsx';
import { PlatformIcon } from './platform-icon.tsx';
import { rpc } from './rpc.ts';

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
  }, [conversationId]);

  return cards;
}

/** 采纳 / 忽略：反馈会在该会话下次运行时交给 agent，用于调整之后的建议。 */
function CardFeedback({ conversationId, card }: { conversationId: string; card: ReminderCard }) {
  const [verdict, setVerdict] = useState<Verdict>();

  const send = useMutation({
    mutationFn: (next: Verdict) =>
      rpc.assistant.feedback({
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
      {cards.map(card => (
        <li key={card.key} className="reminder-card">
          <p className="text-muted-foreground truncate text-[11px]">
            {describeTrigger(card.trigger)}
          </p>
          <p className="line-clamp-4 text-[13px] leading-snug whitespace-pre-wrap">
            {card.text || '正在准备建议…'}
          </p>
          {card.done && <CardFeedback conversationId={conversationId} card={card} />}
        </li>
      ))}
    </ol>
  );
}

/** 助手会话顶栏的开播 / 下播按钮；开播推荐话题，下播后台复盘并转入下一场。 */
export function LiveControl({ conversation }: { conversation: Conversation }) {
  const client = useQueryClient();
  const platform = conversation.platform;

  const toggle = useMutation({
    mutationFn: async () => {
      if (!platform) {
        return;
      }

      if (conversation.liveStartedAt) {
        await rpc.live.end(platform);
      } else {
        await rpc.live.start(platform);
      }
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['conversations'] }),
  });

  if (!platform) {
    return null;
  }

  if (!conversation.liveStartedAt) {
    return (
      <Button
        size="sm"
        variant="secondary"
        className="shrink-0"
        disabled={toggle.isPending}
        title="开始本场直播：推荐话题，并开始冷场等提醒"
        onClick={() => toggle.mutate()}
      >
        <Radio data-icon="inline-start" />
        开播
      </Button>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="text-muted-foreground text-xs tabular-nums">
        直播中 · {liveTime(conversation.liveStartedAt)} 开播
      </span>
      <Button
        size="sm"
        variant="ghost"
        disabled={toggle.isPending}
        title="结束本场：复盘后转为历史会话，并开始下一场"
        onClick={() => toggle.mutate()}
      >
        <Square data-icon="inline-start" />
        下播
      </Button>
    </span>
  );
}

/** 未开播的助手会话上覆盖的遮罩：一键开播，也可以先留在会话里准备。 */
export function StartLiveOverlay({
  conversation,
  hidden,
  onDismiss,
}: {
  conversation?: Conversation;
  /** 主播选择先在会话里准备时收起。 */
  hidden: boolean;
  onDismiss: () => void;
}) {
  const platform = conversation?.mode === 'assistant' ? conversation.platform : null;

  if (!platform || conversation?.liveStartedAt || hidden) {
    return null;
  }

  return <StartLivePanel platform={platform} onDismiss={onDismiss} />;
}

function StartLivePanel({
  platform,
  onDismiss,
}: {
  platform: NonNullable<Conversation['platform']>;
  onDismiss: () => void;
}) {
  const client = useQueryClient();
  const { data: room } = useRoom(platform);

  const start = useMutation({
    mutationFn: () => rpc.live.start(platform),
    onSettled: () => client.invalidateQueries({ queryKey: ['conversations'] }),
  });

  return (
    <div className="start-live-overlay">
      <div className="grid max-w-sm justify-items-center gap-3 text-center">
        <PlatformIcon platform={platform} size={32} />
        <h2 className="text-lg font-medium">{platformLabels[platform]}助手</h2>
        <p className="text-muted-foreground text-sm tabular-nums">
          {room ? `直播间 ${room.roomId} · ${statusLabels[room.state]}` : '还没有绑定直播间'}
        </p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          开播后会推荐本场话题，并开始礼物答谢、进场分析、冷场与热度等提醒。
        </p>
        <Button
          size="lg"
          className="mt-2 min-w-36"
          disabled={!room || start.isPending}
          onClick={() => start.mutate()}
        >
          <Radio data-icon="inline-start" />
          {start.isPending ? '正在开播…' : '开播'}
        </Button>
        {!room && (
          <Link
            to="/settings"
            className="text-foreground text-xs underline-offset-3 hover:underline"
          >
            去设置绑定直播间
          </Link>
        )}
        {start.isError && (
          <p role="alert" className="text-destructive text-xs">
            {start.error.message}
          </p>
        )}
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-3 hover:underline"
          onClick={onDismiss}
        >
          先在这里准备
        </button>
      </div>
    </div>
  );
}
