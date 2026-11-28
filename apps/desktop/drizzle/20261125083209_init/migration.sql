CREATE TABLE `conversation_models` (
	`conversation_id` text PRIMARY KEY,
	`choice` text NOT NULL,
	CONSTRAINT `fk_conversation_models_conversation_id_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY,
	`platform` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `custom_model_providers` (
	`id` text PRIMARY KEY,
	`config` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_keys` (
	`id` text PRIMARY KEY,
	`value` blob NOT NULL
);
--> statement-breakpoint
CREATE TABLE `platform_live_rooms` (
	`platform` text PRIMARY KEY,
	`room_id` text NOT NULL
);
