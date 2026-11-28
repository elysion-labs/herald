import { createClient as createBilibiliClient } from '@elysionjs/blive-ws';
import type { BiliEvent as BilibiliEvent, Medal, User } from '@elysionjs/blive-ws';
import { parseCookie } from 'cookie';
import { WebSocket } from 'ws';

import type {
  ActivityDetail,
  LiveChat,
  LiveChatOptions,
  LivePlatformAdapter,
  LiveViewer,
  RoomProfile,
  RoomProfileOptions,
  ViewerProfile,
} from './index.ts';
import { field, getJson, parseRoomId, userAgent } from './shared.ts';

function plainText(html: string | undefined) {
  const text = html
    ?.replaceAll(/<[^>]+>/g, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

  return text ? text.slice(0, 300) : null;
}

async function resolveRoomId(roomId: string, signal?: AbortSignal) {
  const { data } = await getJson(
    `https://api.live.bilibili.com/room/v1/Room/room_init?id=${encodeURIComponent(roomId)}`,
    { headers: { 'user-agent': userAgent }, signal },
  );

  const canonical = data?.room_id;

  if (typeof canonical !== 'number' || !Number.isSafeInteger(canonical) || canonical <= 0) {
    throw new Error('无法确认 B 站直播间号码');
  }

  return String(canonical);
}

async function fetchRoomProfile(
  roomId: string,
  { signal }: RoomProfileOptions = {},
): Promise<RoomProfile> {
  const init = { headers: { 'user-agent': userAgent }, signal };
  const id = encodeURIComponent(roomId);

  const [info, anchor] = await Promise.all([
    getJson(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${id}`, init),
    getJson(
      `https://api.live.bilibili.com/live_user/v1/UserInfo/get_anchor_in_room?roomid=${id}`,
      init,
    ),
  ]);

  const room = info.data ?? {};
  const user = (anchor.data?.info ?? {}) as Record<string, unknown>;
  const area = [field(room.parent_area_name), field(room.area_name)].filter(Boolean).join(' / ');

  return {
    platform: 'bilibili',
    roomId,
    streamer: field(user.uname),
    streamerId: typeof user.uid === 'number' ? String(user.uid) : null,
    title: field(room.title),
    area: area === '' ? null : area,
    tags: field(room.tags)?.split(',') ?? [],
    followers: typeof room.attention === 'number' ? room.attention : null,
    description: plainText(field(room.description) ?? undefined),
    live: room.live_status === 1 ? 'live' : 'offline',
  };
}

async function fetchViewerProfile(
  viewerId: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<ViewerProfile> {
  const body = await getJson(
    `https://api.bilibili.com/x/web-interface/card?mid=${encodeURIComponent(viewerId)}`,
    { headers: { 'user-agent': userAgent, referer: 'https://www.bilibili.com/' }, signal },
  );

  const card = (body.data?.card ?? {}) as Record<string, unknown>;
  const level = (card.level_info ?? {}) as Record<string, unknown>;
  const official = (card.Official ?? {}) as Record<string, unknown>;

  return {
    name: field(card.name),
    sign: field(card.sign)?.slice(0, 200) ?? null,
    level: typeof level.current_level === 'number' ? level.current_level : null,
    followers: typeof card.fans === 'number' ? card.fans : null,
    official: field(official.title),
  };
}

function bilibiliViewer(user: User, medal?: Medal | null): LiveViewer {
  return {
    id: user.id > 0 ? String(user.id) : null,
    name: user.name,
    badge: medal ? { name: medal.name, level: medal.level } : null,
    guardLevel: (user.guardLevel ?? 0) > 0 ? user.guardLevel : null,
    payLevel: user.wealthLevel,
  };
}

/** B 站事件转为互动；弹幕与开播状态另行处理，其余返回 undefined。 */
function bilibiliActivity(event: BilibiliEvent): [LiveViewer, ActivityDetail] | undefined {
  if (event.type === 'gift') {
    return [
      bilibiliViewer(event.user, event.medal),
      { kind: 'gift', giftName: event.giftName, count: event.quantity, value: event.price },
    ];
  }

  if (event.type === 'superChat') {
    return [
      bilibiliViewer(event.user, event.medal),
      { kind: 'superChat', text: event.content, value: event.price },
    ];
  }

  if (event.type === 'guard') {
    return [
      bilibiliViewer(event.user),
      { kind: 'guard', guardName: event.guardName, value: event.price },
    ];
  }

  if (event.type === 'entry') {
    return [bilibiliViewer(event.user, event.medal), { kind: 'entry' }];
  }

  if (event.type === 'interaction' && event.interactionType === 1) {
    return [bilibiliViewer(event.user), { kind: 'entry' }];
  }

  return undefined;
}

function createChat({
  roomId,
  readCookie,
  onMessage,
  onActivity,
  onError,
}: LiveChatOptions): LiveChat {
  const room = parseRoomId(roomId);
  const numericRoomId = Number(room);

  if (!Number.isSafeInteger(numericRoomId)) {
    throw new RangeError('Bilibili room ID is outside the safe integer range');
  }

  const client = createBilibiliClient({
    roomId: numericRoomId,
    cookie: readCookie && (async signal => (await readCookie(signal)) ?? ''),
    parseCookie,
    createWebSocket: (url, options) => new WebSocket(url, options),
    reconnect: { maxRetries: 3 },
  });

  client.on('error', onError);
  client.on('event', event => {
    const eventRoom = event.roomId?.toString() ?? room;

    if (event.type === 'message') {
      const viewer = bilibiliViewer(event.user, event.medal);

      onMessage({
        platform: 'bilibili',
        roomId: eventRoom,
        sourceId: event.sourceId,
        deduplicationKey: event.key,
        authorId: viewer.id,
        authorName: event.user.name,
        viewer,
        text: event.content,
        receivedAt: Date.now(),
      });

      return;
    }

    const activity = bilibiliActivity(event);

    if (activity) {
      const [viewer, detail] = activity;
      onActivity?.({
        platform: 'bilibili',
        roomId: eventRoom,
        key: event.key,
        viewer,
        receivedAt: Date.now(),
        ...detail,
      });
    }
  });

  return {
    start: () => client.start(),
    state: () => client.getStatus().status,
    dispose: () => client.dispose(),
  };
}

export const bilibiliAdapter: LivePlatformAdapter = {
  id: 'bilibili',
  label: '哔哩哔哩',
  capabilities: {
    danmaku: true,
    entry: true,
    gift: true,
    superChat: true,
    guard: true,
    viewerProfile: true,
    roomProfile: true,
    badgeLevel: true,
    payLevel: true,
    welcome: true,
  },
  createChat,
  resolveRoomId,
  fetchRoomProfile,
  fetchViewerProfile,
};
