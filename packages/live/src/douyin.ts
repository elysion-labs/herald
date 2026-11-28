import { createClient as createDouyinClient } from '@elysionjs/dylive-ws';
import type { LiveEvent as DouyinEvent, LiveUser as DouyinUser } from '@elysionjs/dylive-ws';

import type {
  ActivityDetail,
  LiveChat,
  LiveChatOptions,
  LivePlatformAdapter,
  LiveViewer,
  RoomProfile,
  RoomProfileOptions,
} from './index.ts';
import { field, getJson, parseRoomId, userAgent } from './shared.ts';

const douyinOrigin = 'https://live.douyin.com';

/** 抖音接口需要 ttwid：优先用登录 cookie 里的，没有时从首页取一个匿名的。 */
async function douyinCookie(cookie: string | null | undefined, signal?: AbortSignal) {
  if (cookie && /(?:^|;\s*)ttwid=/.test(cookie)) {
    return cookie;
  }

  const response = await fetch(`${douyinOrigin}/`, {
    headers: { 'user-agent': userAgent },
    signal,
  });

  const ttwid = response.headers
    .getSetCookie()
    .map(item => item.split(';')[0])
    .find(item => item?.startsWith('ttwid='));

  return [cookie, ttwid].filter(Boolean).join('; ');
}

async function fetchRoomProfile(
  roomId: string,
  { cookie, signal }: RoomProfileOptions = {},
): Promise<RoomProfile> {
  const query = new URLSearchParams({
    aid: '6383',
    app_name: 'douyin_web',
    live_id: '1',
    device_platform: 'web',
    language: 'zh-CN',
    browser_language: 'zh-CN',
    browser_platform: 'Win32',
    browser_name: 'Chrome',
    browser_version: '140.0.0.0',
    web_rid: roomId,
  });

  const body = await getJson(`${douyinOrigin}/webcast/room/web/enter/?${query}`, {
    headers: {
      'user-agent': userAgent,
      referer: `${douyinOrigin}/`,
      cookie: await douyinCookie(cookie, signal),
    },
    signal,
  });

  const room = ((body.data?.data as unknown[] | undefined)?.[0] ?? {}) as Record<string, unknown>;
  const owner = (room.owner ?? {}) as Record<string, unknown>;

  return {
    platform: 'douyin',
    roomId,
    streamer: field(owner.nickname),
    streamerId: field(owner.id_str),
    title: field(room.title),
    area: null,
    tags: [],
    followers: null,
    description: field(owner.signature)?.slice(0, 300) ?? null,
    live: room.status === 2 ? 'live' : 'offline',
  };
}

function douyinViewer(user: DouyinUser): LiveViewer {
  return {
    id: user.id ?? null,
    name: user.name === '' ? null : user.name,
    badge: user.fansClub ?? null,
    guardLevel: null,
    payLevel: user.payLevel ?? null,
  };
}

/** 抖音事件转为互动；连击礼物只在连击结束时上报一次（10 钻 = 1 元）。 */
function douyinActivity(event: DouyinEvent): ActivityDetail | undefined {
  if (event.type === 'gift') {
    if (event.gift.combo && !event.repeatEnd) {
      return undefined;
    }

    const counts = [event.comboCount, event.repeatCount, event.groupCount];
    const count = event.totalCount ?? counts.find(value => value > 0) ?? 1;

    const diamonds = event.gift.diamondCount;

    return {
      kind: 'gift',
      giftName: event.gift.name ?? '礼物',
      count,
      value: diamonds === undefined ? null : (diamonds * count) / 10,
    };
  }

  if (event.type === 'member') {
    return { kind: 'entry' };
  }

  return event.type === 'follow' ? { kind: 'follow' } : undefined;
}

function createChat({
  roomId,
  readCookie,
  onMessage,
  onActivity,
  onError,
}: LiveChatOptions): LiveChat {
  const room = parseRoomId(roomId);

  const client = createDouyinClient({
    roomId: room,
    cookie: readCookie,
    reconnect: { maxRetries: 3 },
  });

  client.on('error', onError);
  client.on('event', event => {
    const eventRoom = event.roomId ?? room;
    const viewer = douyinViewer(event.user);

    if (event.type === 'message') {
      onMessage({
        platform: 'douyin',
        roomId: eventRoom,
        sourceId: event.id ?? null,
        deduplicationKey: event.id ? `${eventRoom}:${event.id}` : null,
        authorId: viewer.id,
        authorName: viewer.name,
        viewer,
        text: event.content,
        receivedAt: Date.now(),
      });

      return;
    }

    const detail = douyinActivity(event);

    if (detail) {
      onActivity?.({
        platform: 'douyin',
        roomId: eventRoom,
        key: event.id ? `${eventRoom}:${event.id}` : null,
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

export const douyinAdapter: LivePlatformAdapter = {
  id: 'douyin',
  label: '抖音',
  capabilities: {
    danmaku: true,
    entry: true,
    gift: true,
    superChat: false,
    guard: false,
    viewerProfile: false,
    roomProfile: true,
    badgeLevel: true,
    payLevel: true,
    welcome: true,
  },
  createChat,
  fetchRoomProfile,
};
