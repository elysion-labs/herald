import { describeTrigger, reminderPlatform } from '@herald/live-assistant/settings';
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import BroadcastIcon from 'kubai-icons-react/icons/radio-tower';
import { ThumbsDown, ThumbsUp } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { kubaiMixed } from './kubai-colors.ts';
import { LiveDuration, RoomIndicators, useRooms } from './live-status.tsx';
import { PlatformIcon } from './platform-icon.tsx';
import { useReminderCards } from './reminders.tsx';
import type { ReminderCard, ReminderVerdict } from './reminders.tsx';
import { rpc } from './rpc.ts';
import { conversationsKey, useWorkspace, workspaceKey } from './workspace-context.ts';

export type Conversation = Awaited<ReturnType<typeof rpc.conversations.list>>[number];

/** 弹幕栏顶部：当前助手会话的实时提醒卡片。 */
export function AssistantReminders({ conversationId }: { conversationId: string }) {
  const { cards } = useReminderCards(conversationId);

  return <ReminderCards conversationId={conversationId} cards={cards} />;
}

/** 采纳 / 忽略：反馈会在该会话下次运行时交给 agent，用于调整之后的建议。 */
function CardFeedback({ conversationId, card }: { conversationId: string; card: ReminderCard }) {
  const { id: workspaceId } = useWorkspace();
  const { resolveCard } = useReminderCards(conversationId);
  const { verdict } = card;

  const send = useMutation({
    mutationFn: (next: ReminderVerdict) =>
      rpc.assistant.feedback({
        workspaceId,
        conversationId,
        verdict: next,
        summary: `${describeTrigger(card.trigger)}：${card.text.slice(0, 120)}`.slice(0, 300),
      }),
    onSuccess: (_, next) => resolveCard(card.key, next),
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
    <ol
      className="grid max-h-[40%] shrink-0 gap-1.5 overflow-y-auto px-3 pb-2"
      aria-label="助手提醒"
    >
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
  const startedAt = conversation.liveStartedAt;
  const active = startedAt !== null;
  const { mutation, busy } = useLiveAction(active ? 'end' : 'start');
  const label = active ? '下播' : '开播';

  return (
    <div className="live-control">
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground gap-2 rounded-md px-2 text-xs"
        disabled={busy || (!active && !rooms?.length)}
        aria-label={label}
        onClick={() => mutation.mutate()}
      >
        <span className="status-dot" data-tone={active ? 'live' : undefined} aria-hidden="true" />
        {startedAt && <LiveDuration startedAt={startedAt} />}
        <span>{label}</span>
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
export function StartLiveOverlay({ onDismiss }: { onDismiss: () => void }) {
  const { name } = useWorkspace();
  const { data: rooms, error, isPending } = useRooms();
  const { mutation, busy } = useLiveAction('start');
  const bound = Boolean(rooms?.length);

  return (
    <div className="start-live-overlay">
      <div className="start-live-content">
        <BroadcastIcon size={32} color={kubaiMixed.broadcast} aria-hidden="true" />
        <h2 className="max-w-full truncate text-xl font-medium tracking-tight">{name}</h2>
        {bound ? (
          <RoomIndicators rooms={rooms} />
        ) : (
          <p className="text-muted-foreground text-sm">
            {error?.message ?? (isPending ? '正在读取直播间…' : '还没有绑定直播间')}
          </p>
        )}
        <Button
          size="lg"
          className="mt-3 min-w-28 rounded-lg"
          disabled={!bound || busy}
          onClick={() => mutation.mutate()}
        >
          {busy ? '正在开播…' : '开播'}
        </Button>
        {!bound && !isPending && !error && (
          <Link
            to="/settings"
            search={{ section: 'rooms' }}
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
        <Button variant="link" size="sm" className="text-muted-foreground" onClick={onDismiss}>
          先在这里准备
        </Button>
      </div>
    </div>
  );
}
