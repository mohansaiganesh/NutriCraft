CREATE INDEX `daily_logs_user_date` ON `daily_logs` (`user_id`,`logged_date`);--> statement-breakpoint
CREATE INDEX `daily_logs_user_updated` ON `daily_logs` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `daily_logs_food` ON `daily_logs` (`food_item_id`);--> statement-breakpoint
CREATE INDEX `food_items_user_updated` ON `food_items` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `meal_items_user_updated` ON `meal_items` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `meal_items_meal` ON `meal_items` (`meal_id`);--> statement-breakpoint
CREATE INDEX `meal_items_food` ON `meal_items` (`food_item_id`);--> statement-breakpoint
CREATE INDEX `meals_user_updated` ON `meals` (`user_id`,`updated_at`);