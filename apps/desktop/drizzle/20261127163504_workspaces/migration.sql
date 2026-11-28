CREATE TABLE `workspace_rooms` (
	`workspace_id` text NOT NULL,
	`platform` text NOT NULL,
	`room_id` text NOT NULL,
	CONSTRAINT `fk_workspace_rooms_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`assistant` text NOT NULL
);
--> statement-breakpoint
-- 工作区引入后仅重建会话与直播数据，保留全局模型和 Agent 设置。
DELETE FROM `conversation_models`;--> statement-breakpoint
DELETE FROM `app_settings` WHERE `key` = 'assistant';--> statement-breakpoint
DROP TABLE `conversations`;--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`live_platforms` text DEFAULT '[]' NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`mode` text DEFAULT 'chat' NOT NULL,
	`danmaku_cursor` integer DEFAULT 0 NOT NULL,
	`live_started_at` integer,
	CONSTRAINT `fk_conversations_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
DROP TABLE `danmaku`;--> statement-breakpoint
CREATE TABLE `danmaku` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT,
	`evidence_id` text NOT NULL UNIQUE,
	`workspace_id` text NOT NULL,
	`platform` text NOT NULL,
	`room_id` text NOT NULL,
	`author_id` text,
	`author_name` text,
	`text` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `danmaku_workspace_sequence` ON `danmaku` (`workspace_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `danmaku_workspace_platform_time` ON `danmaku` (`workspace_id`,`platform`,`received_at`);--> statement-breakpoint
CREATE INDEX `danmaku_workspace_platform_author_time` ON `danmaku` (`workspace_id`,`platform`,`author_id`,`received_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_assistant_workspace` ON `conversations` (`workspace_id`) WHERE "conversations"."mode" = 'assistant';--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_rooms_platform_room` ON `workspace_rooms` (`platform`,`room_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_rooms_workspace_platform` ON `workspace_rooms` (`workspace_id`,`platform`);--> statement-breakpoint
DROP TABLE `platform_live_rooms`;