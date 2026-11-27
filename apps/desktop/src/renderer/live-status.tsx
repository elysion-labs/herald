import type { LivePlatform } from '@herald/live';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { platformLabels } from '../shared/platforms.ts';
import { PlatformIcon } from './platform-icon.tsx';
import { rpc } from './rpc.ts';
import { useWorkspace, workspaceKey } from './workspace-context.ts';

export type Room = Awaited<ReturnType<typeof rpc.rooms.list>>[number];
type RoomState = Room['state'];

export const statusLabels: Record<RoomState, string> = {
  idle: '未连接',
  connecting: '连接中',
  connected: '弹幕已连接',
  reconnecting: '重连中',
  stopped: '已断开',
  failed: '连接失败',
  disposed: '已断开',
};

const tones: Partial<Record<RoomState, 'live' | 'busy' | 'error'>> = {
  connected: 'live',
  connecting: 'busy',
  reconnecting: 'busy',
  failed: 'error',
};

export const roomsKey = (id: string) => [...workspaceKey(id), 'rooms'];

export function useRooms() {
  const { id: workspaceId } = useWorkspace();

  return useQuery({
    queryKey: roomsKey(workspaceId),
    queryFn: ({ signal }) => rpc.rooms.list({ workspaceId }, { signal }),
    refetchInterval: 1500,
  });
}

export function StatusDot({ room }: { room?: Room }) {
  return (
    <span
      className="status-dot"
      data-tone={room ? tones[room.state] : undefined}
      aria-hidden="true"
    />
  );
}

export function roomSummary(room: Room) {
  return `${platformLabels[room.platform]} ${room.roomId} · ${statusLabels[room.state]}`;
}

export function RoomIndicators({
  rooms = [],
  compact = false,
}: {
  rooms?: Room[];
  compact?: boolean;
}) {
  return (
    <ul className="flex w-full min-w-0 items-center justify-center gap-3">
      {rooms.map(room => (
        <li
          key={room.platform}
          className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs tabular-nums"
        >
          <StatusDot room={room} />
          {compact ? (
            <>
              <span className="truncate">{shortPlatformLabels[room.platform]}</span>
              <span className={rooms.length > 1 ? 'sr-only' : 'truncate'}>
                {statusLabels[room.state]}
              </span>
            </>
          ) : (
            <span className="truncate">{roomSummary(room)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export const shortPlatformLabels: Record<LivePlatform, string> = {
  bilibili: 'B 站',
  douyin: '抖音',
};

export function LiveDuration({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const digits = (value: number) => String(value).padStart(2, '0');
  const elapsed = `${digits(minutes % 60)}:${digits(seconds % 60)}`;

  return <span className="tabular-nums">{hours ? `${hours}:${elapsed}` : elapsed}</span>;
}

export function PlatformIcons({
  platforms,
  size = 14,
}: {
  platforms: readonly LivePlatform[];
  size?: number;
}) {
  if (!platforms.length) {
    return null;
  }

  const label = platforms.map(platform => platformLabels[platform]).join('、');

  return (
    <span className="flex shrink-0 items-center gap-1" title={label}>
      {platforms.map(platform => (
        <PlatformIcon key={platform} platform={platform} size={size} />
      ))}
      <span className="sr-only">{label}</span>
    </span>
  );
}
