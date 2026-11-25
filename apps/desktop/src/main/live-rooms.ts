import { randomUUID } from 'node:crypto';
import { EventEmitter, on } from 'node:events';

import { createLiveChat } from '@herald/live';
import type { LiveChatMessage, LivePlatform } from '@herald/live';
import { ORPCError } from '@orpc/server';
import { eq } from 'drizzle-orm';

import { liveRoomUrl, parseLiveRoom } from '../shared/live-room.ts';
import { platforms } from '../shared/platforms.ts';
import { schema } from './db/index.ts';
import type { Database } from './db/index.ts';
import { readLiveCookies } from './platform-accounts.ts';

interface RoomConnection {
  client?: ReturnType<typeof createLiveChat>;
  error?: string;
  received: number;
  recent: LiveMessage[];
}

export type LiveMessage = LiveChatMessage & { evidenceId: string };

const recentLimit = 30;
const recentWindow = 2 * 60 * 1000;

function explainFailure(error: unknown) {
  if (!(error instanceof Error)) {
    return '弹幕客户端未能启动，请重试。';
  }

  if (/Cookie is no longer logged in|code -101/i.test(error.message)) {
    return '平台登录已失效或需要登录，请登录后重连。';
  }

  if (/Cookie provider/i.test(error.message)) {
    return '暂时无法读取平台登录状态，请重连。';
  }

  if (/room_init|not live|room.?id/i.test(error.message)) {
    return '暂时无法获取房间信息，请核对直播间号码和开播状态。';
  }

  if (/getDanmuInfo.*(352|403|412)|rejected WebSocket authentication/i.test(error.message)) {
    return '平台拒绝了弹幕连接，请确认账号已登录后重连。';
  }

  return '暂时无法连接弹幕服务，请检查网络和直播状态。';
}

export function openLiveRooms(db: Database) {
  const { platformLiveRooms: table } = schema;

  const readRoom = (platform: LivePlatform) =>
    db.select().from(table).where(eq(table.platform, platform)).get()?.roomId;

  const saveRoom = (platform: LivePlatform, roomId: string) =>
    db
      .insert(table)
      .values({ platform, roomId })
      .onConflictDoUpdate({ target: table.platform, set: { roomId } })
      .run();

  const removeRoom = (platform: LivePlatform) =>
    db.delete(table).where(eq(table.platform, platform)).run();

  const connections = new Map<LivePlatform, RoomConnection>();
  /** 去重后的新弹幕广播：实时弹幕浮窗与自动提醒都订阅它。 */
  const events = new EventEmitter<{ message: [LiveMessage] }>();
  events.setMaxListeners(0);

  function stop(platform: LivePlatform) {
    const previous = connections.get(platform);
    connections.delete(platform);
    void previous?.client?.dispose().catch(() => undefined);
  }

  function status(platform: LivePlatform) {
    const roomId = readRoom(platform);

    if (!roomId) {
      return null;
    }

    const connection = connections.get(platform);
    const state = connection?.client?.state() ?? (connection?.error ? 'failed' : 'idle');

    return {
      roomId,
      url: liveRoomUrl(platform, roomId),
      state,
      error: state === 'connected' ? undefined : connection?.error,
      received: connection?.received ?? 0,
    };
  }

  function connect(platform: LivePlatform) {
    stop(platform);
    const roomId = readRoom(platform);

    if (!roomId) {
      return;
    }

    const connection: RoomConnection = { received: 0, recent: [] };
    connections.set(platform, connection);

    try {
      const client = createLiveChat({
        platform,
        roomId,
        readCookie: signal => readLiveCookies(platform, signal),
        onError(error) {
          connection.error = explainFailure(error);
        },
        onMessage(message) {
          if (connections.get(platform) !== connection) {
            return;
          }

          const remembered = rememberMessage(connection, message);

          if (remembered) {
            events.emit('message', remembered);
          }
        },
      });

      connection.client = client;
      void client.start().catch((error: unknown) => {
        connection.error = explainFailure(error);
      });
    } catch (error) {
      connection.error = explainFailure(error);
      console.warn('Herald live client failed to start', platform, error);
    }
  }

  return {
    status,
    connect,
    onMessage(listener: (message: LiveMessage) => void) {
      events.on('message', listener);

      return () => events.off('message', listener);
    },
    /** 先推送最近的弹幕快照，再逐条推送新弹幕。 */
    async *watch(platform: LivePlatform, signal?: AbortSignal) {
      const updates = on(events, 'message', { signal });

      try {
        yield connections.get(platform)?.recent ?? [];

        for await (const [message] of updates as AsyncIterableIterator<[LiveMessage]>) {
          if (message.platform === platform) {
            yield [message];
          }
        }
      } finally {
        await updates.return?.();
      }
    },
    start() {
      platforms.forEach(connect);
    },
    stop() {
      platforms.forEach(stop);
    },
    recent(platform: LivePlatform) {
      const since = Date.now() - recentWindow;

      return connections.get(platform)?.recent.filter(message => message.receivedAt >= since) ?? [];
    },
    setBinding(platform: LivePlatform, input: string | null) {
      if (input === null) {
        removeRoom(platform);
        stop(platform);

        return null;
      }

      const roomId = parseLiveRoom(platform, input);

      if (!roomId) {
        throw new ORPCError('BAD_REQUEST', { message: '请输入当前平台的直播间号码或官方直播链接' });
      }

      const previous = status(platform);
      saveRoom(platform, roomId);

      if (previous?.roomId !== roomId || previous.state !== 'connected') {
        connect(platform);
      }

      return status(platform);
    },
  };
}

function rememberMessage(connection: RoomConnection, message: LiveChatMessage) {
  const key = message.deduplicationKey;

  if (key && connection.recent.some(item => item.deduplicationKey === key)) {
    return undefined;
  }

  const remembered: LiveMessage = {
    ...message,
    evidenceId: randomUUID(),
    text: message.text.slice(0, 300),
  };

  connection.received += 1;
  connection.recent.push(remembered);

  if (connection.recent.length > recentLimit) {
    connection.recent.shift();
  }

  return remembered;
}
