import { sql } from 'drizzle-orm';
import { blob, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import type { ChatModelChoice, CustomProvider } from '../../shared/model-settings.ts';
import { platforms } from '../../shared/platforms.ts';

/** 会话列表索引；标题以 pi session jsonl 中的 session_info 为准，这里只做缓存。 */
export const conversations = sqliteTable(
  'conversations',
  {
    id: text().primaryKey(),
    /** 只有平台助手会话有平台；普通会话为 null。 */
    platform: text({ enum: platforms }),
    title: text().notNull(),
    createdAt: integer('created_at').notNull(),
    /** chat：普通聊天，不区分平台；assistant：固定的平台助手，注入新弹幕并接收提醒，每个平台一个。 */
    mode: text({ enum: ['chat', 'assistant'] })
      .notNull()
      .default('chat'),
    /** 助手模式已注入到上下文的最后一条弹幕时间。 */
    danmakuCursor: integer('danmaku_cursor').notNull().default(0),
    /** 直播场次的开播时间；助手会话开播后写入，下播后该会话转为普通会话并保留这个时间。 */
    liveStartedAt: integer('live_started_at'),
  },
  table => [
    uniqueIndex('conversations_assistant_platform')
      .on(table.platform)
      .where(sql`${table.mode} = 'assistant'`),
  ],
);

export const platformLiveRooms = sqliteTable('platform_live_rooms', {
  platform: text({ enum: platforms }).primaryKey(),
  roomId: text('room_id').notNull(),
});

/** safeStorage 加密后的 API Key。 */
export const modelKeys = sqliteTable('model_keys', {
  id: text().primaryKey(),
  value: blob({ mode: 'buffer' }).notNull(),
});

export const customModelProviders = sqliteTable('custom_model_providers', {
  id: text().primaryKey(),
  config: text({ mode: 'json' }).$type<CustomProvider>().notNull(),
});

export const conversationModels = sqliteTable('conversation_models', {
  conversationId: text('conversation_id')
    .primaryKey()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  choice: text({ mode: 'json' }).$type<ChatModelChoice>().notNull(),
});

/** 应用级设置，键值对，值为 JSON。 */
export const appSettings = sqliteTable('app_settings', {
  key: text().primaryKey(),
  value: text({ mode: 'json' }).notNull(),
});

/** 弹幕表由 @herald/danmaku 定义，这里重新导出以纳入 drizzle 迁移。 */
export { danmaku } from '@herald/danmaku/schema';
