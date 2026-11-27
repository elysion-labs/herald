import { createClient as createBilibiliClient } from '@elysionjs/blive-ws';
import type { BiliEvent as BilibiliEvent } from '@elysionjs/blive-ws';
import { createClient as createDouyinClient } from '@elysionjs/dylive-ws';
import type { LiveEvent as DouyinEvent, LiveUser as DouyinUser } from '@elysionjs/dylive-ws';
import { parseCookie } from 'cookie';
import { WebSocket } from 'ws';

export type LivePlatform = 'bilibili' | 'douyin';

/** 观众身份信息，用于判断是否值得互动。 */
export interface LiveViewer {
  id: string | null;
  name: string | null;
  /** B 站粉丝牌 / 抖音粉丝团灯牌。 */
  badge: { name: string; level: number } | null;
  /** B 站大航海：1 总督、2 提督、3 舰长。 */
  guardLevel: number | null;
  /** 抖音财富等级。 */
  payLevel: number | null;
}

export interface LiveChatMessage {
  platform: LivePlatform;
  roomId: string;
  sourceId: string | null;
  deduplicationKey: string | null;
  authorId: string | null;
  authorName: string | null;
  viewer: LiveViewer;
  text: string;
  receivedAt: number;
}

interface ActivityBase {
  platform: LivePlatform;
  roomId: string;
  key: string | null;
  viewer: LiveViewer;
  receivedAt: number;
}

/** 弹幕以外的互动：礼物、醒目留言、上舰、进场、关注。金额统一为人民币元。 */
export type LiveActivity = ActivityBase &
  (
    | { kind: 'gift'; giftName: string; count: number; value: number | null }
    | { kind: 'superChat'; text: string; value: number }
    | { kind: 'guard'; guardName: string; value: number }
    | { kind: 'entry' }
    | { kind: 'follow' }
  );

interface LiveChatOptions {
  platform: LivePlatform;
  roomId: string;
  readCookie?: (signal: AbortSignal) => Promise<string | null>;
  onMessage: (message: LiveChatMessage) => void;
  onActivity?: (activity: LiveActivity) => void;
  onError: (error: Error) => void;
}

/** 直播间是否在播；unknown 表示暂时无法判断。 */
export type LiveStatus = 'live' | 'offline' | 'unknown';

const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

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

/** 主播与直播间的公开资料，用于让 agent 了解当前绑定的直播间。 */
export interface RoomProfile {
  platform: LivePlatform;
  roomId: string;
  streamer: string | null;
  streamerId: string | null;
  title: string | null;
  area: string | null;
  tags: string[];
  followers: number | null;
  description: string | null;
  live: LiveStatus;
}

function plainText(html: string | undefined) {
  const text = html
    ?.replaceAll(/<[^>]+>/g, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

  return text ? text.slice(0, 300) : null;
}

/** 取字符串字段，空值和非字符串都返回 null。 */
function field(value: unknown) {
  return typeof value === 'string' && value ? value : null;
}

async function getJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);

  return (await response.json()) as { data?: Record<string, unknown> };
}

async function bilibiliProfile(roomId: string, signal?: AbortSignal): Promise<RoomProfile> {
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
    area: area || null,
    tags: field(room.tags)?.split(',') ?? [],
    followers: typeof room.attention === 'number' ? room.attention : null,
    description: plainText(field(room.description) ?? undefined),
    live: room.live_status === 1 ? 'live' : 'offline',
  };
}

async function douyinProfile(
  roomId: string,
  cookie: string | null | undefined,
  signal?: AbortSignal,
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

/** 读取主播与直播间资料；失败时抛出错误。 */
export function fetchRoomProfile(
  platform: LivePlatform,
  roomId: string,
  { cookie, signal }: { cookie?: string | null; signal?: AbortSignal } = {},
) {
  return platform === 'bilibili'
    ? bilibiliProfile(roomId, signal)
    : douyinProfile(roomId, cookie, signal);
}

function bilibiliViewer(
  user: {
    id: number;
    name: string | null;
    guardLevel: number | null;
  },
  medal?: { name: string; level: number } | null,
): LiveViewer {
  return {
    id: user.id > 0 ? String(user.id) : null,
    name: user.name,
    badge: medal ? { name: medal.name, level: medal.level } : null,
    guardLevel: (user.guardLevel ?? 0) > 0 ? user.guardLevel : null,
    payLevel: null,
  };
}

function douyinViewer(user: DouyinUser): LiveViewer {
  return {
    id: user.id ?? null,
    name: user.name || null,
    badge: user.fansClub ?? null,
    guardLevel: null,
    payLevel: user.payLevel ?? null,
  };
}

type ActivityDetail = LiveActivity extends infer Item
  ? Item extends ActivityBase
    ? Omit<Item, keyof ActivityBase>
    : never
  : never;

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

  return event.type === 'entry'
    ? [bilibiliViewer(event.user, event.medal), { kind: 'entry' }]
    : undefined;
}

/** 抖音事件转为互动；连击礼物只在连击结束时上报一次（10 钻 = 1 元）。 */
function douyinActivity(event: DouyinEvent): ActivityDetail | undefined {
  if (event.type === 'gift') {
    if (event.gift.combo && !event.repeatEnd) {
      return undefined;
    }

    const count =
      event.totalCount ?? (event.comboCount || event.repeatCount || event.groupCount || 1);

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

export function createLiveChat({
  platform,
  roomId,
  readCookie,
  onMessage,
  onActivity,
  onError,
}: LiveChatOptions) {
  const room = roomId.trim();

  if (!/^[1-9]\d*$/.test(room)) {
    throw new TypeError('Expected a numeric live room ID');
  }

  if (platform === 'bilibili') {
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
          platform,
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
          platform,
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
        platform,
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
        platform,
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
