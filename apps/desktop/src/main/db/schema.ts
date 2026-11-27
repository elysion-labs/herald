import type { AssistantSettings } from '@herald/live-assistant/settings';
import { sql } from 'drizzle-orm';
import { blob, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import type { ChatModelChoice, CustomProvider } from '../../shared/model-settings.ts';
import { platforms } from '../../shared/platforms.ts';

export const workspaces = sqliteTable('workspaces', {
  id: text().primaryKey(),
  name: text().notNull(),
  createdAt: integer('created_at').notNull(),
  assistant: text({ mode: 'json' }).$type<AssistantSettings>().notNull(),
});

export const workspaceRooms = sqliteTable(
  'workspace_rooms',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    platform: text({ enum: platforms }).notNull(),
    roomId: text('room_id').notNull(),
  },
  table => [
    uniqueIndex('workspace_rooms_platform_room').on(table.platform, table.roomId),
    uniqueIndex('workspace_rooms_workspace_platform').on(table.workspaceId, table.platform),
  ],
);

/** 会话列表索引；标题以 pi session jsonl 中的 session_info 为准，这里只做缓存。 */
export const conversations = sqliteTable(
  'conversations',
  {
    id: text().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    livePlatforms: text('live_platforms', { mode: 'json' })
      .$type<(typeof platforms)[number][]>()
      .notNull()
      .default(sql`'[]'`),
    title: text().notNull(),
    createdAt: integer('created_at').notNull(),
    /** chat：普通聊天；assistant：每个工作区一个助手，注入新弹幕并接收提醒。 */
    mode: text({ enum: ['chat', 'assistant'] })
      .notNull()
      .default('chat'),
    /** 助手模式已注入到上下文的最后一条弹幕序号。 */
    danmakuCursor: integer('danmaku_cursor').notNull().default(0),
    /** 直播场次的开播时间；助手会话开播后写入，下播后该会话转为普通会话并保留这个时间。 */
    liveStartedAt: integer('live_started_at'),
  },
  table => [
    uniqueIndex('conversations_assistant_workspace')
      .on(table.workspaceId)
      .where(sql`${table.mode} = 'assistant'`),
  ],
);

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
