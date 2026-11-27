import { Link } from '@tanstack/react-router';
import { ArrowDown, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

import { platformLabels } from '../shared/platforms.ts';
import { AssistantReminders } from './assistant-mode.tsx';
import { RoomIndicators, shortPlatformLabels, useRooms } from './live-status.tsx';
import { rpc } from './rpc.ts';
import { useWorkspace } from './workspace-context.ts';

type LiveMessages =
  Awaited<ReturnType<typeof rpc.rooms.watch>> extends AsyncIterable<infer Batch> ? Batch : never;

const keep = 200;

function useDanmaku(bindingKey: string) {
  const { id: workspaceId } = useWorkspace();
  const [snapshot, setSnapshot] = useState<{ key: string; messages: LiveMessages }>();

  useEffect(() => {
    const controller = new AbortController();

    async function watch() {
      try {
        const stream = await rpc.rooms.watch({ workspaceId }, { signal: controller.signal });
        let recent: LiveMessages = [];

        for await (const batch of stream) {
          recent = [...recent, ...batch].slice(-keep);
          setSnapshot({ key: bindingKey, messages: recent });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('弹幕订阅失败', error);
        }
      }
    }

    void watch();

    return () => controller.abort();
  }, [workspaceId, bindingKey]);

  return snapshot?.key === bindingKey ? snapshot.messages : [];
}

/** 助手会话里位于聊天与浏览器之间的实时弹幕栏，顶部是最新的提醒。 */
export function DanmakuPanel({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  const { data: rooms, isPending, isError } = useRooms();
  const bindingKey = rooms?.map(room => `${room.platform}:${room.roomId}`).join(',') ?? '';
  const messages = useDanmaku(bindingKey);
  const list = useRef<HTMLOListElement>(null);
  const [following, setFollowing] = useState(true);
  const showPlatform = (rooms?.length ?? 0) > 1;

  useLayoutEffect(() => {
    const node = list.current;

    if (node && following) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, following]);

  return (
    <aside className="danmaku-panel" aria-label="实时弹幕">
      <header className="danmaku-header">
        <div className="grid min-w-0 gap-1">
          <h2 className="text-sm font-medium">实时弹幕</h2>
          {Boolean(rooms?.length) && <RoomIndicators rooms={rooms} compact />}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground ml-auto"
          aria-label="关闭实时弹幕"
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      <AssistantReminders conversationId={conversationId} />
      <div className="relative flex min-h-0 flex-1 flex-col">
        {messages.length === 0 ? (
          <p className="text-muted-foreground grid flex-1 place-items-center px-6 py-10 text-center text-xs">
            <DanmakuEmpty bound={Boolean(rooms?.length)} pending={isPending} error={isError} />
          </p>
        ) : (
          <ol
            ref={list}
            className="danmaku-list min-h-0 flex-1 overflow-y-auto px-3.5 py-2"
            aria-live="polite"
            onScroll={event => {
              const node = event.currentTarget;
              setFollowing(node.scrollHeight - node.scrollTop - node.clientHeight < 24);
            }}
          >
            {messages.map(message => (
              <li
                key={message.evidenceId}
                className="danmaku-row"
                title={new Date(message.receivedAt).toLocaleTimeString('zh-CN')}
              >
                <div className="text-muted-foreground flex min-w-0 items-baseline gap-2 text-xs">
                  <span className="truncate">
                    {message.authorName ?? message.authorId ?? '观众'}
                  </span>
                  {showPlatform && (
                    <span className="danmaku-source" aria-label={platformLabels[message.platform]}>
                      {shortPlatformLabels[message.platform]}
                    </span>
                  )}
                </div>
                <p className="text-[13px] leading-relaxed wrap-anywhere whitespace-pre-wrap">
                  {message.text}
                </p>
              </li>
            ))}
          </ol>
        )}
        {!following && (
          <Button
            size="xs"
            variant="secondary"
            className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full shadow"
            onClick={() => setFollowing(true)}
          >
            <ArrowDown data-icon="inline-start" />
            新弹幕
          </Button>
        )}
      </div>
    </aside>
  );
}

function DanmakuEmpty({
  bound,
  pending,
  error,
}: {
  bound: boolean;
  pending: boolean;
  error: boolean;
}) {
  if (pending) {
    return '正在读取直播间…';
  }

  if (error) {
    return '无法读取直播间';
  }

  if (bound) {
    return '暂时还没有弹幕';
  }

  return (
    <span>
      还没有绑定直播间。
      <Link
        to="/settings"
        search={{ section: 'rooms' }}
        className="text-foreground underline underline-offset-3"
      >
        去绑定
      </Link>
    </span>
  );
}
