CREATE TABLE `assistant_traces` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`question` text NOT NULL,
	`answer` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`error_kind` text,
	`stop_reason` text,
	`model` text DEFAULT '' NOT NULL,
	`llm_calls` integer DEFAULT 0 NOT NULL,
	`tool_calls` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`started_at` text NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assistant_traces_user_updated` ON `assistant_traces` (`user_id`,`updated_at`);