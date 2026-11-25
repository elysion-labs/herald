import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { createLiveChat } from '@herald/live';
import type { LiveChatMessage, LivePlatform } from '@herald/live';
import { ORPCError } from '@orpc/server';

import { liveRoomUrl, parseLiveRoom } from '../shared/live-room.ts';
import { platforms } from '../shared/platforms.ts';
import { readLiveCookies } from './platform-accounts.ts';

interface RoomConnection {
  client?: ReturnType<typeof createLiveChat>;
  error?: string;
  received: number;
  recent: (LiveChatMessage & { evidenceId: string })[];
}

const recentLimit = 30;
const recentWindow = 2 * 60 * 1000;

function initializeRoomBindings(database: DatabaseSync) {
  const table = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
  const migrate = !table.get('platform_live_rooms') && table.get('live_rooms');

  database.exec(`
    CREATE TABLE IF NOT EXISTS platform_live_rooms (
      platform TEXT PRIMARY KEY CHECK (platform IN ('bilibili', 'douyin')),
      room_id TEXT NOT NULL
    )
  `);

  if (migrate) {
    database.exec(`
      INSERT OR IGNORE INTO platform_live_rooms (platform, room_id)
      SELECT conversations.platform, live_rooms.room_id
      FROM live_rooms JOIN conversations ON conversations.id = live_rooms.conversation_id
      ORDER BY conversations.createdAt DESC, conversations.rowid DESC
    `);
  }
}

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

export function openLiveRooms(database: DatabaseSync) {
  initializeRoomBindings(database);
  const read = database.prepare('SELECT room_id FROM platform_live_rooms WHERE platform = ?');
  const save = database.prepare('INSERT OR REPLACE INTO platform_live_rooms VALUES (?, ?)');
  const remove = database.prepare('DELETE FROM platform_live_rooms WHERE platform = ?');
  const connections = new Map<LivePlatform, RoomConnection>();

  function stop(platform: LivePlatform) {
    const previous = connections.get(platform);
    connections.delete(platform);
    void previous?.client?.dispose().catch(() => undefined);
  }

  function status(platform: LivePlatform) {
    const roomId = read.get(platform)?.room_id as string | undefined;

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
    const roomId = read.get(platform)?.room_id as string | undefined;

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
          if (connections.get(platform) === connection) {
            rememberMessage(connection, message);
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
        remove.run(platform);
        stop(platform);

        return null;
      }

      const roomId = parseLiveRoom(platform, input);

      if (!roomId) {
        throw new ORPCError('BAD_REQUEST', { message: '请输入当前平台的直播间号码或官方直播链接' });
      }

      const previous = status(platform);
      save.run(platform, roomId);

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
    return;
  }

  connection.received += 1;
  connection.recent.push({
    ...message,
    evidenceId: randomUUID(),
    text: message.text.slice(0, 300),
  });

  if (connection.recent.length > recentLimit) {
    connection.recent.shift();
  }
}
