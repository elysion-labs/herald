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
