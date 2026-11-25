import type { LivePlatform } from '@herald/live';

import { liveOrigins } from './platforms.ts';

const roomNumber = /^[1-9]\d{0,19}$/;

export function liveRoomUrl(platform: LivePlatform, roomId: string) {
  return `${liveOrigins[platform]}/${roomId}`;
}

export function parseLiveRoom(platform: LivePlatform, value: string) {
  const input = value.trim();
  const url = URL.parse(input.includes('://') ? input : `https://${input}`);
  let id = input;

  if (
    !roomNumber.test(id) &&
    url?.origin === liveOrigins[platform] &&
    !url.username &&
    !url.password
  ) {
    id = url.pathname.match(/^\/([1-9]\d*)\/?$/)?.[1] ?? '';
  }

  if (!roomNumber.test(id) || (platform === 'bilibili' && !Number.isSafeInteger(Number(id)))) {
    return undefined;
  }

  return id;
}
