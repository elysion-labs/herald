import type { LivePlatform } from '@herald/live';
import { Link } from '@tanstack/react-router';
import { ArrowDown, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

import { platformLabels } from '../shared/platforms.ts';
import { roomSummary, StatusDot, useRoom } from './live-status.tsx';
import { PlatformIcon } from './platform-icon.tsx';
import { rpc } from './rpc.ts';

type LiveMessages =
  Awaited<ReturnType<typeof rpc.rooms.watch>> extends AsyncIterable<infer Batch> ? Batch : never;

const keep = 200;

function useDanmaku(platform: LivePlatform) {
  const [messages, setMessages] = useState<LiveMessages>([]);

  useEffect(() => {
    const controller = new AbortController();

    async function watch() {
      try {
        const stream = await rpc.rooms.watch(platform, { signal: controller.signal });
        let first = true;

        for await (const batch of stream) {
          setMessages(current => (first ? batch : [...current, ...batch]).slice(-keep));
          first = false;
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('弹幕订阅失败', error);
        }
      }
    }

    void watch();

    return () => controller.abort();
  }, [platform]);

  return messages;
}

/** 悬浮在聊天右上角的实时弹幕参考面板。 */
export function DanmakuPanel({
  platform,
  onClose,
}: {
  platform: LivePlatform;
  onClose: () => void;
}) {
  const messages = useDanmaku(platform);
  const { data: room } = useRoom(platform);
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
        <PlatformIcon platform={platform} size={16} />
        <h2 className="text-sm font-medium">实时弹幕</h2>
        <span
          className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[11px]"
          title={roomSummary(room)}
        >
          <StatusDot room={room} />
          <span className="truncate tabular-nums">{room ? room.roomId : '未绑定'}</span>
        </span>
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
      <div className="relative flex min-h-0 flex-1 flex-col">
        {messages.length === 0 ? (
          <p className="text-muted-foreground grid flex-1 place-items-center px-6 py-10 text-center text-xs">
            {room ? (
              '暂时还没有弹幕'
            ) : (
              <span>
                {platformLabels[platform]}还没有绑定直播间，
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
                className="danmaku-row py-1 text-[13px] leading-snug"
                title={new Date(message.receivedAt).toLocaleTimeString('zh-CN')}
              >
                <span className="text-muted-foreground mr-1.5">
                  {message.authorName ?? message.authorId ?? '观众'}
                </span>
                <span className="break-words">{message.text}</span>
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
