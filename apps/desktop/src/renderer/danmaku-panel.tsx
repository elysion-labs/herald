import { Link } from '@tanstack/react-router';
import { ArrowDown, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

import { platformLabels } from '../shared/platforms.ts';
import { AssistantReminders } from './assistant-mode.tsx';
import { RoomIndicators, useRooms } from './live-status.tsx';
import { PlatformIcon } from './platform-icon.tsx';
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
  const { data: rooms } = useRooms();
  const bindingKey = rooms?.map(room => `${room.platform}:${room.roomId}`).join(',') ?? '';
  const messages = useDanmaku(bindingKey);
  const list = useRef<HTMLOListElement>(null);
  const [following, setFollowing] = useState(true);

  useLayoutEffect(() => {
    const node = list.current;

    if (node && following) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, following]);

  return (
    <aside className="danmaku-panel" aria-label="实时弹幕">
      <header className="flex h-11 shrink-0 items-center gap-2 pr-1.5 pl-3">
        <h2 className="shrink-0 text-sm font-medium">实时弹幕</h2>
        <RoomIndicators rooms={rooms} compact />
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
            {rooms?.length ? (
              '暂时还没有弹幕'
            ) : (
              <span>
                当前工作区还没有绑定直播间，
                <Link to="/settings" className="text-foreground underline underline-offset-3">
                  去设置
                </Link>
              </span>
            )}
          </p>
        ) : (
          <ol
            ref={list}
            className="danmaku-list min-h-0 flex-1 overflow-y-auto px-3 pb-3"
            aria-live="polite"
            onScroll={event => {
              const node = event.currentTarget;
              setFollowing(node.scrollHeight - node.scrollTop - node.clientHeight < 24);
            }}
          >
            {messages.map(message => (
              <li
                key={message.evidenceId}
                className="danmaku-row flex items-start gap-1.5 py-1 text-[13px] leading-snug"
                title={new Date(message.receivedAt).toLocaleTimeString('zh-CN')}
              >
                <span className="mt-0.5 shrink-0" title={platformLabels[message.platform]}>
                  <PlatformIcon platform={message.platform} size={13} />
                  <span className="sr-only">{platformLabels[message.platform]}</span>
                </span>
                <div className="min-w-0">
                  <span className="text-muted-foreground mr-1.5">
                    {message.authorName ?? message.authorId ?? '观众'}
                  </span>
                  <span className="break-words">{message.text}</span>
                </div>
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
