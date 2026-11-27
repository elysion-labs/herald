import { describeTrigger } from '@herald/live-assistant/settings';
import type { ReminderTrigger } from '@herald/live-assistant/settings';
import BellRing from 'kubai-icons-react/icons/bell-ring';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { PlatformIcon } from './platform-icon.tsx';
import { rpc } from './rpc.ts';
import { useWorkspace } from './workspace-context.ts';

type AssistantEvent =
  Awaited<ReturnType<typeof rpc.assistant.watch>> extends AsyncIterable<infer Event>
    ? Event
    : never;

type ReminderTurns = Extract<AssistantEvent, { phase: 'update' }>['turns'];

export interface LiveReminder {
  trigger: ReminderTrigger;
  turns: ReminderTurns;
}

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

/**
 * 订阅当前会话的后台提醒：进行中的提醒实时显示，结束后刷新历史。
 * 模型判断无需提醒（SKIP）时后端会撤销这条提醒，界面上也随之消失。
 */
export function useLiveReminder(conversationId: string, onSettled: () => Promise<unknown>) {
  const { id: workspaceId } = useWorkspace();
  const [reminder, setReminder] = useState<LiveReminder>();

  useEffect(() => {
    const controller = new AbortController();

    async function watch() {
      try {
        const stream = await rpc.assistant.watch({ workspaceId }, { signal: controller.signal });

        for await (const event of stream) {
          if (event.conversationId !== conversationId) {
            continue;
          }

          if (event.phase === 'start') {
            setReminder({ trigger: event.trigger, turns: [] });
          } else if (event.phase === 'update') {
            setReminder(current => current && { ...current, turns: event.turns });
          } else {
            await onSettled();
            setReminder(undefined);
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
  }, [conversationId, onSettled, workspaceId]);

  return reminder;
}

/** 聊天流里的提醒条目：触发原因一行，后面跟 Herald 的建议。 */
export function ReminderItem({
  trigger,
  live = false,
}: {
  trigger: ReminderTrigger;
  live?: boolean;
}) {
  return (
    <div className="reminder-item mx-auto flex w-full max-w-3xl items-center gap-2 px-6 pb-3">
      <span className="bg-secondary/70 flex min-w-0 items-center gap-2 rounded-full py-1 pr-3 pl-1.5 text-xs">
        {'platform' in trigger ? (
          <PlatformIcon platform={trigger.platform} size={16} />
        ) : (
          <BellRing size={16} color="#F59E0B" className="shrink-0" />
        )}
        <span className="text-foreground/90 shrink-0 font-medium">
          {triggerLabels[trigger.kind]}
        </span>
        <span className="text-muted-foreground min-w-0 truncate" title={describeTrigger(trigger)}>
          {describeTrigger(trigger)}
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
