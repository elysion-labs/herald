import type { LivePlatform } from '@herald/live';
import { useQuery } from '@tanstack/react-query';

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
  return <span className="status-dot" data-tone={room ? tones[room.state] : undefined} />;
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
    <ul className={compact ? 'flex min-w-0 items-center gap-2' : 'grid gap-1.5'}>
      {rooms.map(room => (
        <li
          key={room.platform}
          title={roomSummary(room)}
          className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs"
        >
          <PlatformIcon platform={room.platform} size={14} />
          <StatusDot room={room} />
          <span className={compact ? 'sr-only' : 'truncate tabular-nums'}>{roomSummary(room)}</span>
        </li>
      ))}
    </ul>
  );
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
