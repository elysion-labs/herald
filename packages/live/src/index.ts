import { createClient as createBilibiliClient } from '@elysionjs/blive-ws';
import { createClient as createDouyinClient } from '@elysionjs/dylive-ws';
import { parseCookie } from 'cookie';
import { WebSocket } from 'ws';

export type LivePlatform = 'bilibili' | 'douyin';

export interface LiveChatMessage {
  platform: LivePlatform;
  roomId: string;
  sourceId: string | null;
  deduplicationKey: string | null;
  authorId: string | null;
  authorName: string | null;
  text: string;
  receivedAt: number;
}

interface LiveChatOptions {
  platform: LivePlatform;
  roomId: string;
  readCookie?: (signal: AbortSignal) => Promise<string | null>;
  onMessage: (message: LiveChatMessage) => void;
  onError: (error: Error) => void;
  /** 平台推送的开播 / 下播事件（目前只有 B 站会推送）。 */
  onLiveStatus?: (status: LiveStatus) => void;
}

/** 直播间是否在播；unknown 表示暂时无法判断。 */
export type LiveStatus = 'live' | 'offline' | 'unknown';

const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function bilibiliStatus(roomId: string, signal?: AbortSignal): Promise<LiveStatus> {
  const response = await fetch(
    `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${encodeURIComponent(roomId)}`,
    { headers: { 'user-agent': userAgent }, signal },
  );

  const body = (await response.json()) as { code?: number; data?: { live_status?: number } };
  const status = body.code === 0 ? body.data?.live_status : undefined;

  if (status === undefined) {
    return 'unknown';
  }

  return status === 1 ? 'live' : 'offline';
}

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

async function douyinStatus(
  roomId: string,
  cookie: string | null | undefined,
  signal?: AbortSignal,
): Promise<LiveStatus> {
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

  const response = await fetch(`${douyinOrigin}/webcast/room/web/enter/?${query}`, {
    headers: {
      'user-agent': userAgent,
      referer: `${douyinOrigin}/`,
      cookie: await douyinCookie(cookie, signal),
    },
    signal,
  });

  const body = (await response.json()) as {
    status_code?: number;
    data?: { data?: { status?: number }[] };
  };

  const status = body.status_code === 0 ? body.data?.data?.[0]?.status : undefined;

  if (status === undefined) {
    return 'unknown';
  }

  return status === 2 ? 'live' : 'offline';
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

/**
 * 查询直播间当前是否在播。
 * B 站读 room/v1/Room/get_info 的 live_status（1 为直播中）；
 * 抖音读 webcast/room/web/enter 的 room.status（2 为直播中）。网络或解析失败时返回 unknown。
 */
export async function fetchLiveStatus(
  platform: LivePlatform,
  roomId: string,
  { cookie, signal }: { cookie?: string | null; signal?: AbortSignal } = {},
): Promise<LiveStatus> {
  try {
    return platform === 'bilibili'
      ? await bilibiliStatus(roomId, signal)
      : await douyinStatus(roomId, cookie, signal);
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    return 'unknown';
  }
}

export function createLiveChat({
  platform,
  roomId,
  readCookie,
  onMessage,
  onError,
  onLiveStatus,
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
      if (event.type === 'liveStart' || event.type === 'liveEnd') {
        onLiveStatus?.(event.type === 'liveStart' ? 'live' : 'offline');

        return;
      }

      if (event.type !== 'message') {
        return;
      }

      onMessage({
        platform,
        roomId: event.roomId?.toString() ?? room,
        sourceId: event.sourceId,
        deduplicationKey: event.key,
        authorId: event.user.id > 0 ? String(event.user.id) : null,
        authorName: event.user.name,
        text: event.content,
        receivedAt: Date.now(),
      });
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
  client.on('event', event =>
    onMessage({
      platform,
      roomId: event.roomId ?? room,
      sourceId: event.id ?? null,
      deduplicationKey: event.id ? `${event.roomId ?? room}:${event.id}` : null,
      authorId: event.user.id ?? null,
      authorName: event.user.name || null,
      text: event.content,
      receivedAt: Date.now(),
    }),
  );

  return {
    start: () => client.start(),
    state: () => client.getStatus().status,
    dispose: () => client.dispose(),
  };
}
