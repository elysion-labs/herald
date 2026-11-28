import { describeTrigger, reminderPlatform } from '@herald/live-assistant/settings';
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import BroadcastIcon from 'kubai-icons-react/icons/radio-tower';
import { LoaderCircle, Radio, ThumbsDown, ThumbsUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { platformLabels, platforms } from '../shared/platforms.ts';
import { kubaiMixed } from './kubai-colors.ts';
import { LiveDuration, roomSummary, StatusDot, useRooms } from './live-status.tsx';
import type { Room } from './live-status.tsx';
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
  const { data: rooms, error, isPending, refetch } = useRooms();
  const { mutation, busy } = useLiveAction('start');

  return (
    <div className="start-live-overlay">
      <div className="start-live-content">
        <BroadcastIcon size={24} color={kubaiMixed.tv} aria-hidden="true" />
        <h2 className="text-lg font-semibold tracking-tight">准备开播</h2>
        {isPending && (
          <p role="status" className="text-muted-foreground text-xs">
            正在读取直播间…
          </p>
        )}
        {rooms && <StartLiveRooms rooms={rooms} />}
        {error && (
          <div className="text-destructive flex flex-wrap items-center justify-center gap-2 text-xs">
            <span role="alert" className="wrap-anywhere">
              {error.message}
            </span>
            <button
              type="button"
              className="underline underline-offset-3"
              onClick={() => void refetch()}
            >
              重试
            </button>
          </div>
        )}
        <div className="mt-2 grid w-full justify-items-center gap-2">
          {mutation.error && (
            <p role="alert" className="text-destructive max-w-full text-xs wrap-anywhere">
              {mutation.error.message}
            </p>
          )}
          <Button
            size="lg"
            className="h-10 w-full max-w-50 rounded-lg"
            disabled={!rooms?.length || busy}
            onClick={() => mutation.mutate()}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <Radio />}
            {busy ? '正在开播…' : '开播'}
          </Button>
          <Button
            variant="link"
            size="sm"
            className="text-muted-foreground text-xs"
            onClick={onDismiss}
          >
            先在这里准备
          </Button>
        </div>
      </div>
    </div>
  );
}

function StartLiveRooms({ rooms }: { rooms: Room[] }) {
  const bindingLink = 'hover:text-foreground underline underline-offset-3';

  if (!rooms.length) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
        还没有绑定直播间
        <span aria-hidden="true">·</span>
        <Link to="/settings" search={{ section: 'rooms' }} className={bindingLink}>
          去绑定
        </Link>
      </p>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <ul className="start-live-rooms text-muted-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px]">
        {platforms.map(platform => {
          const room = rooms.find(item => item.platform === platform);

          return (
            <li key={platform} className="flex min-w-0 items-center gap-1.5">
              {room ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      className="inline-flex min-w-0 items-center gap-1.5 rounded-sm"
                      aria-label={roomSummary(room)}
                    >
                      <PlatformIcon platform={platform} size={14} />
                      <span className="max-w-24 truncate tabular-nums">{room.roomId}</span>
                      <StatusDot room={room} />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={6}>{roomSummary(room)}</TooltipContent>
                </Tooltip>
              ) : (
                <Link
                  to="/settings"
                  search={{ section: 'rooms' }}
                  className={`inline-flex items-center gap-1.5 ${bindingLink}`}
                  aria-label={`绑定${platformLabels[platform]}直播间`}
                >
                  <PlatformIcon platform={platform} size={14} />
                  绑定
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </TooltipProvider>
  );
}
