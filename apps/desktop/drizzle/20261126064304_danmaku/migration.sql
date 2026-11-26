CREATE TABLE `danmaku` (
	`evidence_id` text PRIMARY KEY,
	`platform` text NOT NULL,
	`room_id` text NOT NULL,
	`author_id` text,
	`author_name` text,
	`text` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `danmaku_platform_time` ON `danmaku` (`platform`,`received_at`);--> statement-breakpoint
CREATE INDEX `danmaku_platform_author_time` ON `danmaku` (`platform`,`author_id`,`received_at`);