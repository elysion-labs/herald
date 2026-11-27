import { describeTrigger, reminderPlatform } from '@herald/live-assistant/settings';
import type { ReminderTrigger } from '@herald/live-assistant/settings';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import BellRing from 'kubai-icons-react/icons/bell-ring';
import { CircleAlert, LoaderCircle, X } from 'lucide-react';
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';

import { usageKey } from './context-usage.tsx';
import { PlatformIcon } from './platform-icon.tsx';
import { rpc } from './rpc.ts';
import { conversationsKey, useWorkspace, workspaceKey } from './workspace-context.ts';

type AssistantEvent =
  Awaited<ReturnType<typeof rpc.assistant.watch>> extends AsyncIterable<infer Event>
    ? Event
    : never;

type ReminderTurns = Extract<AssistantEvent, { phase: 'update' }>['turns'];
type ReminderFailure = Extract<AssistantEvent, { phase: 'done'; error: string }>;

export interface LiveReminder {
  conversationId: string;
  trigger: ReminderTrigger;
  turns: ReminderTurns;
}

const ReminderContext = createContext<{
  reminder?: LiveReminder;
  failure?: ReminderFailure;
  dismissFailure: () => void;
}>({ dismissFailure: () => undefined });

const triggerLabels: Record<ReminderTrigger['kind'], string> = {
  silence: '冷场提醒',
  viewer: '观众提醒',
  keyword: '关注词提醒',
  periodic: '弹幕分析',
  liveStart: '开播话题',
  liveEnd: '下播复盘',
  gift: '答谢',
  entry: '进场分析',
  welcome: '新观众',
  heat: '热度变化',
};

/** 按工作区订阅提醒，让下播归档和切换页面时收到的失败仍可见。 */
export function ReminderProvider({ children }: { children: ReactNode }) {
  const { id: workspaceId } = useWorkspace();
  const client = useQueryClient();
  const [reminder, setReminder] = useState<LiveReminder>();
  const [failure, setFailure] = useState<ReminderFailure>();

  useEffect(() => {
    const controller = new AbortController();

    async function watch() {
      try {
        const stream = await rpc.assistant.watch({ workspaceId }, { signal: controller.signal });

        for await (const event of stream) {
          const { conversationId } = event;

          if (event.phase === 'start') {
            setReminder({ conversationId, trigger: event.trigger, turns: [] });
          } else if (event.phase === 'update') {
            setReminder(current =>
              current?.conversationId === conversationId
                ? { ...current, turns: event.turns }
                : current,
            );
          } else {
            if (event.error !== undefined) {
              setFailure(event);
            }

            await Promise.all([
              client.invalidateQueries({
                queryKey: [...workspaceKey(workspaceId), 'history', conversationId],
              }),
              client.invalidateQueries({ queryKey: usageKey(workspaceId, conversationId) }),
              client.invalidateQueries({ queryKey: conversationsKey(workspaceId) }),
            ]);
            setReminder(current =>
              current?.conversationId === conversationId ? undefined : current,
            );
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
  }, [client, workspaceId]);

  return (
    <ReminderContext value={{ reminder, failure, dismissFailure: () => setFailure(undefined) }}>
      {children}
    </ReminderContext>
  );
}

export function useLiveReminder(conversationId: string) {
  const { reminder } = useContext(ReminderContext);

  return reminder?.conversationId === conversationId ? reminder : undefined;
}

export function ReminderFailureCard({
  conversationId,
  isAssistant,
}: {
  conversationId?: string;
  isAssistant: boolean;
}) {
  const { failure, dismissFailure } = useContext(ReminderContext);

  const isVisible =
    failure?.conversationId === conversationId ||
    (isAssistant && failure?.trigger.kind === 'liveEnd');

  if (!failure || !isVisible) {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pt-3">
      <div className="reminder-card">
        <div className="flex min-w-0 items-start gap-2">
          <div role="alert" className="min-w-0 flex-1 space-y-0.5">
            <p className="text-destructive flex items-center gap-1.5 text-xs font-medium">
              <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
              {triggerLabels[failure.trigger.kind]}失败
            </p>
            <p className="text-foreground/90 text-[13px] wrap-anywhere">{failure.error}</p>
          </div>
          {failure.errorCode === 'PRECONDITION_FAILED' && (
            <Link
              to="/settings"
              search={{ section: 'models' }}
              className="text-foreground shrink-0 text-xs leading-6 underline underline-offset-3"
            >
              去设置
            </Link>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="关闭提醒失败提示"
            onClick={dismissFailure}
          >
            <X />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 聊天流里的提醒条目：触发原因一行，后面跟 Herald 的建议。 */
export function ReminderItem({
  trigger,
  live = false,
}: {
  trigger: ReminderTrigger;
  live?: boolean;
}) {
  const platform = reminderPlatform(trigger);
  const summary = describeTrigger(trigger);

  const label =
    trigger.kind === 'entry' && trigger.viewers.length > 1
      ? '批量进场分析'
      : triggerLabels[trigger.kind];

  return (
    <div className="reminder-item mx-auto flex w-full max-w-3xl items-center gap-2 px-6 pb-3">
      <span className="bg-secondary/70 flex min-w-0 items-center gap-2 rounded-full py-1 pr-3 pl-1.5 text-xs">
        {platform ? (
          <PlatformIcon platform={platform} size={16} />
        ) : (
          <BellRing size={16} color="#F59E0B" className="shrink-0" />
        )}
        <span className="text-foreground/90 shrink-0 font-medium">{label}</span>
        <span className="text-muted-foreground min-w-0 truncate" title={summary}>
          {summary}
        </span>
      </span>
      {live && (
        <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
          <LoaderCircle className="size-3.5 animate-spin" />
          正在根据弹幕准备建议
        </span>
      )}
    </div>
  );
}
