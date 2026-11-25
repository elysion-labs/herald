import { blob, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { ChatModelChoice, CustomProvider } from '../../shared/model-settings.ts';
import { platforms } from '../../shared/platforms.ts';

/** 会话列表索引；标题以 pi session jsonl 中的 session_info 为准，这里只做缓存。 */
export const conversations = sqliteTable('conversations', {
  id: text().primaryKey(),
  platform: text({ enum: platforms }).notNull(),
  title: text().notNull(),
  createdAt: integer('created_at').notNull(),
});

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
