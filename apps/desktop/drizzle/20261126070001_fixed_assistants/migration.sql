PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_conversations` (
	`id` text PRIMARY KEY,
	`platform` text,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`mode` text DEFAULT 'chat' NOT NULL,
	`danmaku_cursor` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_conversations`(`id`, `platform`, `title`, `created_at`, `mode`, `danmaku_cursor`) SELECT `id`, `platform`, `title`, `created_at`, `mode`, `danmaku_cursor` FROM `conversations`;--> statement-breakpoint
DROP TABLE `conversations`;--> statement-breakpoint
ALTER TABLE `__new_conversations` RENAME TO `conversations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_assistant_platform` ON `conversations` (`platform`) WHERE "conversations"."mode" = 'assistant';