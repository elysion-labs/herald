import type { LivePlatform } from '@herald/live';
import { useQuery } from '@tanstack/react-query';

import { rpc } from './rpc.ts';

export type Room = Awaited<ReturnType<typeof rpc.rooms.status>>;
type RoomState = NonNullable<Room>['state'];

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

export function roomQuery(platform: LivePlatform) {
  return {
    queryKey: ['live-room', platform],
    queryFn: () => rpc.rooms.status(platform),
    refetchInterval: 1500,
  };
}

export function useRoom(platform: LivePlatform) {
  return useQuery(roomQuery(platform));
}

export function StatusDot({ room }: { room?: Room }) {
  return <span className="status-dot" data-tone={room ? tones[room.state] : undefined} />;
}

/** 直播间状态的一行摘要：未绑定 / 房间号 · 连接状态。 */
export function roomSummary(room: Room | undefined) {
  return room ? `${room.roomId} · ${statusLabels[room.state]}` : '未绑定直播间';
}
