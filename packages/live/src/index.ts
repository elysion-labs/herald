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
}

export function createLiveChat({
  platform,
  roomId,
  readCookie,
  onMessage,
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
