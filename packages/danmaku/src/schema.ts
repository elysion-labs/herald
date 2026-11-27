import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const livePlatforms = ['bilibili', 'douyin'] as const;

/** 直播间弹幕；evidence_id 供记忆核验引用，agent 通过 query_danmaku 查询。 */
export const danmaku = sqliteTable(
  'danmaku',
  {
    sequence: integer().primaryKey({ autoIncrement: true }),
    evidenceId: text('evidence_id').notNull().unique(),
    workspaceId: text('workspace_id').notNull(),
    platform: text({ enum: livePlatforms }).notNull(),
    roomId: text('room_id').notNull(),
    authorId: text('author_id'),
    authorName: text('author_name'),
    text: text().notNull(),
    receivedAt: integer('received_at').notNull(),
  },
  table => [
    index('danmaku_workspace_sequence').on(table.workspaceId, table.sequence),
    index('danmaku_workspace_platform_time').on(
      table.workspaceId,
      table.platform,
      table.receivedAt,
    ),
    index('danmaku_workspace_platform_author_time').on(
      table.workspaceId,
      table.platform,
      table.authorId,
      table.receivedAt,
    ),
  ],
);
