import { randomUUID } from 'node:crypto';
import { EventEmitter, on } from 'node:events';

import { adapters } from '@herald/live';
import type { LiveActivity, LiveChat, LiveChatMessage, LivePlatform } from '@herald/live';
import { ORPCError } from '@orpc/server';
import { and, eq } from 'drizzle-orm';

import { liveRoomUrl } from '../shared/live-room.ts';
import { platforms } from '../shared/platforms.ts';
import { schema } from './db/index.ts';
import type { Database } from './db/index.ts';
import { readLiveCookies } from './platform-accounts.ts';

interface RoomConnection {
  client?: LiveChat;
  error?: string;
  received: number;
  recent: LiveMessage[];
}

export type LiveMessage = LiveChatMessage & { evidenceId: string };

const recentLimit = 30;

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

export function openLiveRooms(db: Database, workspaceId: string) {
  const { workspaceRooms: table } = schema;
  const workspace = eq(table.workspaceId, workspaceId);
  const binding = (platform: LivePlatform) => and(workspace, eq(table.platform, platform));

  const boundPlatforms = () => platforms.filter(platform => readRoom(platform) !== undefined);

  const readRoom = (platform: LivePlatform) =>
    db.select().from(table).where(binding(platform)).get()?.roomId;

  const saveRoom = (platform: LivePlatform, roomId: string) =>
    db
      .insert(table)
      .values({ workspaceId, platform, roomId })
      .onConflictDoUpdate({ target: [table.workspaceId, table.platform], set: { roomId } })
      .run();

  const removeRoom = (platform: LivePlatform) => db.delete(table).where(binding(platform)).run();

  const connections = new Map<LivePlatform, RoomConnection>();

  /** 去重后的新弹幕广播：实时弹幕浮窗与自动提醒都订阅它。 */
  const lifetime = new AbortController();
  const events = new EventEmitter<{ message: [LiveMessage]; activity: [LiveActivity] }>();
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

    return { roomId, url: liveRoomUrl(platform, roomId), ...connectionStatus(connection) };
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
      const client = adapters[platform].createChat({
        roomId,
        readCookie: signal => readLiveCookies(platform, signal),
        onError(error) {
          connection.error = explainFailure(error);
        },
        onActivity(activity) {
          if (connections.get(platform) === connection) {
            events.emit('activity', activity);
          }
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
    boundPlatforms,
    connect,
    /** 礼物、醒目留言、上舰、进场、关注等互动事件。 */
    onActivity(listener: (activity: LiveActivity) => void) {
      events.on('activity', listener);

      return () => events.off('activity', listener);
    },
    onMessage(listener: (message: LiveMessage) => void) {
      events.on('message', listener);

      return () => events.off('message', listener);
    },
    /** 先推送最近的弹幕快照，再逐条推送新弹幕。 */
    async *watch(platform: LivePlatform | undefined, signal?: AbortSignal) {
      const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;

      if (combined.aborted) {
        return;
      }

      const updates = on(events, 'message', { signal: combined });

      try {
        const selected = platform ? [platform] : boundPlatforms();
        yield selected
          .flatMap(item => connections.get(item)?.recent ?? [])
          .sort((left, right) => left.receivedAt - right.receivedAt);

        for await (const [message] of updates as AsyncIterableIterator<[LiveMessage]>) {
          if (!platform || message.platform === platform) {
            yield [message];
          }
        }
      } catch (error) {
        if (!combined.aborted) {
          throw error;
        }
      } finally {
        await updates.return?.();
      }
    },
    start() {
      platforms.forEach(connect);
    },
    stop() {
      lifetime.abort();
      platforms.forEach(stop);
    },
    setBinding(platform: LivePlatform, roomId: string | null) {
      if (roomId === null) {
        removeRoom(platform);
        stop(platform);

        return null;
      }

      const owner = db
        .select({ workspaceId: table.workspaceId })
        .from(table)
        .where(and(eq(table.platform, platform), eq(table.roomId, roomId)))
        .get();

      if (owner && owner.workspaceId !== workspaceId) {
        throw new ORPCError('CONFLICT', { message: '这个直播间已绑定到其他工作区' });
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

function connectionStatus(connection: RoomConnection | undefined) {
  const state = connection?.client?.state() ?? (connection?.error ? 'failed' : 'idle');

  return {
    state,
    error: state === 'connected' ? undefined : connection?.error,
    received: connection?.received ?? 0,
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
