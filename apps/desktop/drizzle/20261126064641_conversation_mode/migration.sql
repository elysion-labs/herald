ALTER TABLE `conversations` ADD `mode` text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `danmaku_cursor` integer DEFAULT 0 NOT NULL;